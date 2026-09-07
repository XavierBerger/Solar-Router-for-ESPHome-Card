import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { CARD_NAME, CARD_TYPE, CARD_VERSION, REPOSITORY_URL } from "./const";
import { loadDeviceEntities, type DeviceEntity } from "./detect/registry";
import { cardStyles } from "./styles";
import type { HomeAssistant } from "./types/home-assistant";
import type { SolarRouterCardConfig } from "./types/config";

@customElement(CARD_TYPE)
export class SolarRouterCard extends LitElement {
  static override styles = cardStyles;

  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: SolarRouterCardConfig;
  @state() private _entities?: DeviceEntity[];
  @state() private _registryError?: string;

  /** Device the loaded entities belong to, so we reload only when it changes. */
  private _loadedFor?: string;

  public setConfig(config: SolarRouterCardConfig): void {
    if (config.device_id !== undefined && typeof config.device_id !== "string") {
      throw new Error("device_id must be a string");
    }
    this._config = config;
    this._loadedFor = undefined;
    this._entities = undefined;
    this._registryError = undefined;
  }

  public getCardSize(): number {
    return 8;
  }

  public static getStubConfig(): Partial<SolarRouterCardConfig> {
    return { device_id: "" };
  }

  protected override updated(): void {
    const deviceId = this._config?.device_id;
    if (!this.hass || !deviceId || this._loadedFor === deviceId) {
      return;
    }
    this._loadedFor = deviceId;
    void this._loadEntities(this.hass, deviceId);
  }

  private async _loadEntities(hass: HomeAssistant, deviceId: string): Promise<void> {
    try {
      const entities = await loadDeviceEntities(hass, deviceId);
      // Guard against a device change while the request was in flight.
      if (this._loadedFor === deviceId) {
        this._entities = entities;
        this._registryError = undefined;
      }
    } catch (err) {
      if (this._loadedFor === deviceId) {
        this._loadedFor = undefined;
        this._registryError = err instanceof Error ? err.message : String(err);
      }
    }
  }

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

    return html`
      <ha-card .header=${title}>
        <div class="content">${this._renderStatus()} ${this._renderInventory()}</div>
      </ha-card>
    `;
  }

  private _renderStatus(): TemplateResult {
    if (this._registryError) {
      return html`<div class="error">
        Could not read the entity registry: ${this._registryError}
      </div>`;
    }
    if (!this._entities) {
      return html`<div class="badge">Reading the entity registry…</div>`;
    }

    const states = this.hass?.states ?? {};
    const known = this._entities.filter((entity) => states[entity.entityId]);
    const online = known.some(
      (entity) =>
        states[entity.entityId].state !== "unavailable" &&
        states[entity.entityId].state !== "unknown",
    );

    return html`
      <div class="badge">
        <span class="dot ${online ? "" : "offline"}"></span>
        <span>${online ? "Online" : "Offline"}</span>
      </div>
    `;
  }

  private _renderInventory(): TemplateResult | typeof nothing {
    if (!this._entities) {
      return nothing;
    }

    // Phase 1 shows the raw inventory: it is what proves the registry read and
    // the (domain, original_name) key work against a real router. The detection
    // engine of phase 2 replaces this with named sections.
    const entities = [...this._entities].sort(
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
