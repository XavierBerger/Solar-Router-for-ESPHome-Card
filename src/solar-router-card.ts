import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { CARD_NAME, CARD_TYPE, CARD_VERSION, REPOSITORY_URL } from "./const";
import { detectRouter } from "./detect/detect";
import { PACKAGES, compareVersions, matchVersionEntity, readVersion } from "./detect/packages";
import {
  invalidateEntityRegistry,
  loadDeviceEntities,
  type DeviceEntities,
} from "./detect/registry";
import type { DeclaredPackage, PackageCategory, RouterProfile } from "./detect/types";
import { cardStyles } from "./styles";
import type { HomeAssistant } from "./types/home-assistant";
import type { SolarRouterCardConfig } from "./types/config";

const CATEGORY_LABELS: Record<PackageCategory, string> = {
  power_meter: "Power meter",
  engine: "Engine",
  regulator: "Regulator",
  energy_counter: "Energy counter",
  temperature: "Temperature",
  scheduler: "Scheduler",
  system: "System",
};

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
            <span>Choose the solar router this card should display.</span>
          </div>
        </ha-card>
      `;
    }

    const device = this.hass.devices?.[deviceId];
    if (!device) {
      return html`
        <ha-card>
          <div class="error">Device <code>${deviceId}</code> is not in the device registry.</div>
        </ha-card>
      `;
    }

    const title = this._config.name ?? device.name_by_user ?? device.name ?? "Solar Router";

    if (this._registryError) {
      return html`
        <ha-card .header=${title}>
          <div class="content">
            <div class="error">Could not read the entity registry: ${this._registryError}</div>
            ${this._renderReload()}
          </div>
        </ha-card>
      `;
    }

    const profile = this._profile;
    if (!profile) {
      return html`
        <ha-card .header=${title}>
          <div class="content"><div class="badge">Reading the entity registry…</div></div>
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
          ${this._renderStatus(profile)} ${this._renderHardware(profile)}
          ${this._renderModules(profile)}
        </div>
      </ha-card>
    `;
  }

  private _renderReload(): TemplateResult {
    return html`<button class="reload" @click=${this._reload}>Reload</button>`;
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
            ${
              disabledVersions
                ? html`
                    <p><strong>Your module version entities are disabled.</strong></p>
                    <p>
                      This router publishes them, but they are switched off in Home Assistant, so
                      the card cannot see which modules it is built from. Re-enable them in the
                      device settings.
                    </p>
                  `
                : html`
                    <p><strong>Update your Solar Router packages.</strong></p>
                    <p>
                      This card reads the module version each package publishes, which older
                      firmware does not have. In your ESPHome configuration set
                      <code>refresh: 0s</code>, then recompile and upload.
                    </p>
                  `
            }
            <div class="actions">
              <a href=${REPOSITORY_URL} target="_blank" rel="noopener">Documentation</a>
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
            <p><strong>This device is not a solar router.</strong></p>
            <p>
              <code>${deviceId}</code> publishes none of the entities a Solar Router for ESPHome
              device does. Pick another device.
            </p>
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
            <p><strong>No entity for this device yet.</strong></p>
            <p>It may never have connected since it was added. Reload once it is online.</p>
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
        <span>${online ? "Online" : "Offline"}</span>
      </div>
    `;
  }

  /** Engine, measurement source and regulators — none of it knowable before. */
  private _renderHardware(profile: RouterProfile): TemplateResult {
    const meter = profile.packages.find(
      (p) => PACKAGES[p.id].category === "power_meter" && !PACKAGES[p.id].implicit,
    );
    const rows: [string, string][] = [];
    if (profile.engine) {
      rows.push(["Engine", PACKAGES[profile.engine].label]);
    }
    if (meter) {
      rows.push(["Power meter", PACKAGES[meter.id].label]);
    }
    if (profile.regulators.length > 0) {
      rows.push(["Regulator", profile.regulators.map((r) => this._packageLabel(r)).join(" · ")]);
    }
    if (rows.length === 0) {
      return html`${nothing}`;
    }

    return html`
      <div class="hardware">
        ${rows.map(
          ([label, value]) => html`
            <div class="row"><span class="label">${label}</span><span>${value}</span></div>
          `,
        )}
      </div>
    `;
  }

  private _packageLabel(declared: DeclaredPackage): string {
    const label = PACKAGES[declared.id].label;
    return declared.instance ? `${label} ${declared.instance}` : label;
  }

  /**
   * The declared packages and their versions.
   *
   * Versions are shown, never judged. A release only bumps the packages it
   * touched, so uneven versions are normal and flagging the laggards would cry
   * wolf on every installation. For the same reason the highest version is
   * labelled with a `≥`: it is a lower bound on the release, not the release.
   */
  private _renderModules(profile: RouterProfile): TemplateResult {
    const states = this.hass?.states ?? {};
    const shown = profile.packages.filter(
      (declared) => this._showInternal || !PACKAGES[declared.id].implicit,
    );
    const internalCount = profile.packages.length - shown.length;

    let lastCategory: PackageCategory | undefined;
    const bound = this._highestVersion(profile, states);

    return html`
      <details class="modules">
        <summary>
          Modules (${profile.packages.length})
          ${bound ? html`<span class="version">Packages ≥ ${bound}</span>` : nothing}
        </summary>
        <div class="entities">
          ${shown.map((declared) => {
            const category = PACKAGES[declared.id].category;
            const heading = category !== lastCategory ? CATEGORY_LABELS[category] : "";
            lastCategory = category;
            const { version, versionState } = readVersion(states[declared.entityId]?.state);
            return html`
              <div class="entity">
                <span class="domain">${heading}</span>
                <span>
                  <ha-icon icon=${PACKAGES[declared.id].icon}></ha-icon>
                  ${this._packageLabel(declared)}
                </span>
                <span
                  class="value"
                  title=${
                    versionState === "pending"
                      ? "Published about ten seconds after the device boots"
                      : ""
                  }
                  >${version ?? (versionState === "pending" ? "…" : "—")}</span
                >
              </div>
            `;
          })}
          ${
            internalCount > 0
              ? html`
                  <button class="link" @click=${() => (this._showInternal = true)}>
                    Show ${internalCount} internal package${internalCount > 1 ? "s" : ""}
                  </button>
                `
              : nothing
          }
        </div>
      </details>
    `;
  }

  /**
   * Highest version currently published.
   *
   * Recomputed here rather than taken from `profile.packagesVersion`: the
   * profile is built from the registry alone, so it carries no version at all.
   */
  private _highestVersion(
    profile: RouterProfile,
    states: Record<string, { state: string }>,
  ): string | null {
    let best: string | null = null;
    for (const declared of profile.packages) {
      const { version } = readVersion(states[declared.entityId]?.state);
      if (version && (!best || compareVersions(version, best) === 1)) {
        best = version;
      }
    }
    return best;
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
        <summary>Entities on this device (${entities.length})</summary>
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
