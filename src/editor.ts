/**
 * The GUI editor.
 *
 * Two jobs. Pick the router — which is the whole configuration in the common
 * case — and then show what the card recognised on it. That second half is the
 * point: a user who sees their engine, their power meter and their regulators
 * named back at them knows the card understood their installation, before ever
 * looking at a control.
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  renderHardware,
  renderModuleList,
  warningText,
  highestVersion,
} from "./components/module-summary";
import { detectRouter } from "./detect/detect";
import { matchVersionEntity } from "./detect/packages";
import { loadDeviceEntities, type DeviceEntities } from "./detect/registry";
import type { RouterProfile } from "./detect/types";
import { editorStyles } from "./styles";
import type { HomeAssistant } from "./types/home-assistant";
import type { SolarRouterCardConfig } from "./types/config";

/**
 * The form, as Home Assistant's own `ha-form` understands it.
 *
 * The device selector is filtered to ESPHome and no further. Narrowing it to
 * devices that declare a package would be tempting, but it would also hide
 * every router still on older firmware — exactly the users who need to reach
 * the card's "update your packages" message.
 */
const SCHEMA = [
  { name: "device_id", required: true, selector: { device: { integration: "esphome" } } },
  { name: "name", selector: { text: {} } },
  { name: "advanced_open", selector: { boolean: {} } },
] as const;

const LABELS: Record<string, string> = {
  device_id: "Solar router",
  name: "Title",
  advanced_open: "Start with Advanced open",
};

@customElement("solar-router-card-editor")
export class SolarRouterCardEditor extends LitElement {
  static override styles = editorStyles;

  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: SolarRouterCardConfig;
  @state() private _profile?: RouterProfile;
  @state() private _entities?: DeviceEntities;
  @state() private _error?: string;
  @state() private _showInternal = false;

  private _loadedFor?: string;

  public setConfig(config: SolarRouterCardConfig): void {
    this._config = config;
  }

  protected override updated(): void {
    const deviceId = this._config?.device_id;
    if (!this.hass || !deviceId || this._loadedFor === deviceId) {
      return;
    }
    this._loadedFor = deviceId;
    void this._loadProfile(this.hass, deviceId);
  }

  private async _loadProfile(hass: HomeAssistant, deviceId: string): Promise<void> {
    try {
      const entities = await loadDeviceEntities(hass, deviceId);
      if (this._loadedFor !== deviceId) {
        return;
      }
      this._entities = entities;
      this._profile = detectRouter(deviceId, entities.enabled, {
        overrides: this._config?.entities,
      });
      this._error = undefined;
    } catch (err) {
      if (this._loadedFor === deviceId) {
        this._loadedFor = undefined;
        this._error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  private _valueChanged = (event: CustomEvent): void => {
    const value = event.detail.value as SolarRouterCardConfig;
    // `ha-form` hands back every key it knows about, cleared ones included.
    // Dropping the empty ones keeps the YAML a user later opens readable.
    const config: SolarRouterCardConfig = { ...this._config, ...value, type: "" };
    for (const key of ["name", "device_id"] as const) {
      if (!config[key]) {
        delete config[key];
      }
    }
    if (!config.advanced_open) {
      delete config.advanced_open;
    }
    delete (config as Partial<SolarRouterCardConfig>).type;

    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  };

  protected override render(): TemplateResult {
    if (!this.hass || !this._config) {
      return html`${nothing}`;
    }

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${SCHEMA}
        .computeLabel=${(entry: { name: string }) => LABELS[entry.name] ?? entry.name}
        @value-changed=${this._valueChanged}
      ></ha-form>
      ${this._renderRecognised()}
    `;
  }

  private _renderRecognised(): TemplateResult | typeof nothing {
    if (!this._config?.device_id) {
      return nothing;
    }
    if (this._error) {
      return html`<div class="notice error">
        Could not read the entity registry: ${this._error}
      </div>`;
    }

    const profile = this._profile;
    if (!profile) {
      return html`<div class="notice">Reading the entity registry…</div>`;
    }

    switch (profile.firmware) {
      case "outdated":
        return this._renderOutdated();
      case "not_a_router":
        return html`
          <div class="notice warn">
            This device publishes none of the entities a Solar Router does. Pick another one.
          </div>
        `;
      case "unknown":
        return html`
          <div class="notice">
            No entity for this device yet — it may never have connected since it was added.
          </div>
        `;
      case "supported":
        break;
    }

    const states = this.hass?.states ?? {};
    const bound = highestVersion(profile, states);

    return html`
      <div class="recognised">
        <div class="heading">
          <span>Recognised modules</span>
          ${bound ? html`<span class="version">Packages ≥ ${bound}</span>` : nothing}
        </div>
        ${renderHardware(profile)}
        ${renderModuleList(profile, states, {
          showInternal: this._showInternal,
          onShowInternal: () => {
            this._showInternal = true;
          },
        })}
        ${this._renderWarnings(profile)}
      </div>
    `;
  }

  private _renderOutdated(): TemplateResult {
    const disabled = (this._entities?.disabled ?? []).some((entity) => matchVersionEntity(entity));
    return html`
      <div class="notice warn">
        ${
          disabled
            ? html`
                This router's module version entities are disabled in Home Assistant, so the card
                cannot see what it is built from. Re-enable them in the device settings.
              `
            : html`
                This router runs firmware older than the module version sensors. Set
                <code>refresh: 0s</code> in its ESPHome configuration, then recompile and upload.
              `
        }
      </div>
    `;
  }

  /**
   * Consistency warnings.
   *
   * They belong here rather than on the card: they are for whoever is setting
   * the thing up, and none of them stops the card from working.
   */
  private _renderWarnings(profile: RouterProfile): TemplateResult | typeof nothing {
    if (profile.warnings.length === 0) {
      return nothing;
    }
    return html`
      <details class="diagnostic">
        <summary>Diagnostic (${profile.warnings.length})</summary>
        <ul>
          ${profile.warnings.map((warning) => html`<li>${warningText(warning)}</li>`)}
        </ul>
      </details>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "solar-router-card-editor": SolarRouterCardEditor;
  }
}
