import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { renderHardware, renderModuleFold } from "./components/module-summary";
import { renderAdvancedControls, renderDiagnostics } from "./sections/advanced";
import { renderControlSections, renderHeaderControl } from "./sections/controls";
import { renderLive } from "./sections/live";
import { renderSchedulerSections } from "./sections/scheduler";
import { CARD_NAME, CARD_TYPE, CARD_VERSION, REPOSITORY_URL } from "./const";
import { detectRouter } from "./detect/detect";
import { matchVersionEntity } from "./detect/packages";
import {
  invalidateEntityRegistry,
  loadDeviceEntities,
  type DeviceEntities,
} from "./detect/registry";
import type { RouterProfile } from "./detect/types";
import { localize } from "./localize/localize";
import { cardStyles } from "./styles";
import type { HomeAssistant } from "./types/home-assistant";
import type { SolarRouterCardConfig } from "./types/config";

@customElement(CARD_TYPE)
export class SolarRouterCard extends LitElement {
  static override styles = cardStyles;

  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: SolarRouterCardConfig;
  @state() private _profile?: RouterProfile;
  @state() private _entities?: DeviceEntities;
  @state() private _registryError?: string;
  @state() private _showInternal = false;

  /** Device the loaded profile belongs to, so we reload only when it changes. */
  private _loadedFor?: string;

  public setConfig(config: SolarRouterCardConfig): void {
    if (config.device_id !== undefined && typeof config.device_id !== "string") {
      throw new Error("device_id must be a string");
    }
    this._config = config;
    this._reset();
  }

  public getCardSize(): number {
    return 8;
  }

  public static getStubConfig(): Partial<SolarRouterCardConfig> {
    return { device_id: "" };
  }

  /**
   * The GUI editor.
   *
   * Written as a dynamic import because that is the shape Home Assistant
   * documents, but the bundle inlines it: HACS installs a single file, so
   * there is nowhere for a second chunk to live. The editor therefore ships
   * with the card rather than loading on demand.
   */
  public static async getConfigElement(): Promise<HTMLElement> {
    await import("./editor");
    return document.createElement("solar-router-card-editor");
  }

  private _reset(): void {
    this._loadedFor = undefined;
    this._profile = undefined;
    this._entities = undefined;
    this._registryError = undefined;
  }

  protected override updated(): void {
    const deviceId = this._config?.device_id;
    if (!this.hass || !deviceId || this._loadedFor === deviceId) {
      return;
    }
    this._loadedFor = deviceId;
    void this._loadProfile(this.hass, deviceId);
  }

  /**
   * Build the profile once per device, from the registry alone.
   *
   * `Real Power` ticks once a second, so `hass` — and with it `updated()` —
   * changes about as often. Resolving sixty-three roles at that rate would be
   * absurd, and it is unnecessary: which packages and which entities a device
   * has is a registry fact. Only the versions come from the states, and those
   * are read at render time.
   */
  private async _loadProfile(hass: HomeAssistant, deviceId: string): Promise<void> {
    try {
      const entities = await loadDeviceEntities(hass, deviceId);
      if (this._loadedFor !== deviceId) {
        // The device changed while the request was in flight.
        return;
      }
      this._entities = entities;
      this._profile = detectRouter(deviceId, entities.enabled, {
        overrides: this._config?.entities,
      });
      this._registryError = undefined;
    } catch (err) {
      if (this._loadedFor === deviceId) {
        this._loadedFor = undefined;
        this._registryError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  /** Drop the cached registry and look again. See `_renderOutdated`. */
  private _reload = (): void => {
    invalidateEntityRegistry();
    this._reset();
    this.requestUpdate();
  };

  protected override render(): TemplateResult {
    if (!this._config || !this.hass) {
      return html`<ha-card></ha-card>`;
    }

    const deviceId = this._config.device_id;
    if (!deviceId) {
      return html`
        <ha-card>
          <div class="placeholder">
            <ha-icon icon="mdi:transmission-tower-import"></ha-icon>
            <span>${localize(this.hass, "card.choose_device")}</span>
          </div>
        </ha-card>
      `;
    }

    const device = this.hass.devices?.[deviceId];
    if (!device) {
      return html`
        <ha-card>
          <div class="error">${localize(this.hass, "card.device_missing", { deviceId })}</div>
        </ha-card>
      `;
    }

    const title = this._config.name ?? device.name_by_user ?? device.name ?? "Solar Router";

    if (this._registryError) {
      return html`
        <ha-card .header=${title}>
          <div class="content">
            <div class="error">
              ${localize(this.hass, "card.registry_error", { message: this._registryError })}
            </div>
            ${this._renderReload()}
          </div>
        </ha-card>
      `;
    }

    const profile = this._profile;
    if (!profile) {
      return html`
        <ha-card .header=${title}>
          <div class="content">
            <div class="badge">${localize(this.hass, "card.reading_registry")}</div>
          </div>
        </ha-card>
      `;
    }

    switch (profile.firmware) {
      case "outdated":
        return this._renderOutdated(title);
      case "not_a_router":
        return this._renderNotARouter(title, deviceId);
      case "unknown":
        return this._renderNoEntities(title);
      case "supported":
        break;
    }

    return html`
      <ha-card .header=${title}>
        <div class="content">
          ${this._renderStatus(profile)} ${renderHeaderControl(profile, this.hass)}
          ${renderLive(profile, this.hass)} ${renderControlSections(profile, this.hass)}
          ${renderSchedulerSections(profile.schedulers, this.hass)}
          <details class="advanced" ?open=${this._config.advanced_open ?? false}>
            <summary>${localize(this.hass, "card.advanced")}</summary>
            ${renderAdvancedControls(profile, this.hass)} ${renderHardware(this.hass, profile)}
            ${this._renderModuleFold(profile)} ${renderDiagnostics(profile, this.hass)}
          </details>
        </div>
      </ha-card>
    `;
  }

  private _renderReload(): TemplateResult {
    return html`<button class="reload" @click=${this._reload}>
      ${localize(this.hass, "card.reload")}
    </button>`;
  }

  /**
   * Firmware older than the version sensors.
   *
   * A user who disabled the diagnostic entities lands here too and would find
   * "update your packages" baffling, so tell those two apart before advising.
   */
  private _renderOutdated(title: string): TemplateResult {
    const disabledVersions = (this._entities?.disabled ?? []).some((entity) =>
      matchVersionEntity(entity),
    );

    return html`
      <ha-card .header=${title}>
        <div class="content">
          <div class="notice">
            <ha-icon icon="mdi:package-up"></ha-icon>
            <p>
              <strong
                >${localize(
                  this.hass,
                  disabledVersions ? "card.versions_disabled_title" : "card.outdated_title",
                )}</strong
              >
            </p>
            <p>
              ${localize(
                this.hass,
                disabledVersions ? "card.versions_disabled_body" : "card.outdated_body",
              )}
            </p>
            <div class="actions">
              <a href=${REPOSITORY_URL} target="_blank" rel="noopener"
                >${localize(this.hass, "card.documentation")}</a
              >
              ${this._renderReload()}
            </div>
          </div>
          ${this._renderInventory()}
        </div>
      </ha-card>
    `;
  }

  private _renderNotARouter(title: string, deviceId: string): TemplateResult {
    return html`
      <ha-card .header=${title}>
        <div class="content">
          <div class="notice">
            <ha-icon icon="mdi:help-circle-outline"></ha-icon>
            <p><strong>${localize(this.hass, "card.not_a_router_title")}</strong></p>
            <p>${localize(this.hass, "card.not_a_router_body", { deviceId })}</p>
          </div>
        </div>
      </ha-card>
    `;
  }

  private _renderNoEntities(title: string): TemplateResult {
    return html`
      <ha-card .header=${title}>
        <div class="content">
          <div class="notice">
            <ha-icon icon="mdi:cloud-question-outline"></ha-icon>
            <p><strong>${localize(this.hass, "card.no_entities_title")}</strong></p>
            <p>${localize(this.hass, "card.no_entities_body")}</p>
            <div class="actions">${this._renderReload()}</div>
          </div>
        </div>
      </ha-card>
    `;
  }

  private _renderStatus(profile: RouterProfile): TemplateResult {
    const states = this.hass?.states ?? {};
    // The version sensors are excluded on purpose: they publish once and then
    // stay silent, so they are the one set of entities whose staleness says
    // nothing about whether the device is alive.
    const versionEntities = new Set(profile.packages.map((p) => p.entityId));
    const live = Object.values(profile.roles)
      .map((role) => role.entityId)
      .filter((id) => !versionEntities.has(id));
    const online = live.some(
      (id) => states[id] && states[id].state !== "unavailable" && states[id].state !== "unknown",
    );

    return html`
      <div class="badge">
        <span class="dot ${online ? "" : "offline"}"></span>
        <span>${localize(this.hass, online ? "card.online" : "card.offline")}</span>
      </div>
    `;
  }

  private _renderModuleFold(profile: RouterProfile): TemplateResult {
    return renderModuleFold(this.hass, profile, this.hass?.states ?? {}, {
      showInternal: this._showInternal,
      onShowInternal: () => {
        this._showInternal = true;
      },
    });
  }

  /** The raw entity list, kept for the screens that render no controls. */
  private _renderInventory(): TemplateResult {
    const entities = [...(this._entities?.enabled ?? [])].sort(
      (a, b) =>
        a.domain.localeCompare(b.domain) ||
        (a.originalName ?? "").localeCompare(b.originalName ?? ""),
    );
    const states = this.hass?.states ?? {};

    return html`
      <details>
        <summary>
          ${localize(this.hass, "card.entities_on_device", { count: entities.length })}
        </summary>
        <div class="entities">
          ${entities.map(
            (entity) => html`
              <div class="entity">
                <span class="domain">${entity.domain}</span>
                <span class=${entity.originalName ? "" : "unnamed"}>
                  ${entity.originalName ?? entity.entityId}
                </span>
                <span class="value">${states[entity.entityId]?.state ?? "—"}</span>
              </div>
            `,
          )}
        </div>
      </details>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [CARD_TYPE]: SolarRouterCard;
  }
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: CARD_TYPE,
  name: CARD_NAME,
  description: "Controls for a Solar Router for ESPHome, adapted to the modules it was built from.",
  preview: true,
  documentationURL: REPOSITORY_URL,
});

console.info(
  `%c ${CARD_NAME} %c ${CARD_VERSION} `,
  "color: white; background: #0288d1; font-weight: 700;",
  "color: #0288d1; background: white; font-weight: 700;",
);
