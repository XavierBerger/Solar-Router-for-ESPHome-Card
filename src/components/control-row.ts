/**
 * One control, one row.
 *
 * Every section is built from these, so the rules that matter — a value the
 * card cannot reach is said out loud rather than shown as a dash, and a
 * read-only entity never pretends to be editable — are written once.
 */

import { html, nothing, type TemplateResult } from "lit";

import { localize } from "../localize/localize";
import type { ResolvedRole, Unit } from "../detect/types";
import type { HassEntity, HomeAssistant } from "../types/home-assistant";

/** A state the card must render explicitly instead of silently blanking. */
export type Liveness = "ok" | "unavailable" | "unknown" | "missing";

export function liveness(entity: HassEntity | undefined): Liveness {
  if (!entity) {
    return "missing";
  }
  if (entity.state === "unavailable") {
    return "unavailable";
  }
  if (entity.state === "unknown" || entity.state === "") {
    return "unknown";
  }
  return "ok";
}

export function livenessText(
  hass: Pick<HomeAssistant, "language"> | undefined,
  state: Liveness,
): string {
  return state === "ok" ? "" : localize(hass, `liveness.${state}`);
}

export function writeNumber(
  hass: HomeAssistant,
  entityId: string,
  value: number,
): Promise<unknown> {
  return hass.callService("number", "set_value", { value }, { entity_id: entityId });
}

export function writeToggle(hass: HomeAssistant, entityId: string, on: boolean): Promise<unknown> {
  const domain = entityId.slice(0, entityId.indexOf("."));
  return hass.callService(domain, on ? "turn_on" : "turn_off", {}, { entity_id: entityId });
}

/**
 * The number selector configuration for an entity.
 *
 * Bounds come from the entity rather than from the catalogue: the firmware sets
 * them per package, and a slider clamped to the wrong range is worse than no
 * slider. The unit comes from the catalogue instead, because the firmware is
 * inconsistent about it — lowercase `"w"` on one number, an empty string on the
 * reactivities.
 */
function numberSelector(entity: HassEntity, unit: Unit | undefined): Record<string, unknown> {
  const min = typeof entity.attributes.min === "number" ? entity.attributes.min : 0;
  const max = typeof entity.attributes.max === "number" ? entity.attributes.max : 100;
  const step = typeof entity.attributes.step === "number" ? entity.attributes.step : 1;
  return {
    number: {
      min,
      max,
      step,
      // A slider needs room to be worth it; a wide or fine range reads better
      // as a box, which is also what Home Assistant does for its own numbers.
      mode: max - min <= 1000 && step >= 0.1 ? "slider" : "box",
      unit_of_measurement: unit ?? "",
    },
  };
}

export interface RowOptions {
  readonly label: string;
  readonly unit?: Unit;
  /** Shown under the label — the reason a control behaves unexpectedly. */
  readonly note?: string;
  /** A paired reading, such as the countdown belonging to a setpoint. */
  readonly aside?: string;
}

/**
 * Render one resolved role.
 *
 * `writable` comes from the domain that actually matched, which is the whole
 * point of resolving a role against several domains: `Regulator Opening` is a
 * `number` on one engine and a `sensor` on the others, and the card follows
 * whichever it found rather than assuming.
 */
export function renderControlRow(
  hass: HomeAssistant,
  role: ResolvedRole,
  options: RowOptions,
): TemplateResult {
  const entity = hass.states[role.entityId];
  const state = liveness(entity);

  return html`
    <div class="control-row">
      <div class="control-label">
        <span>${options.label}</span>
        ${options.note ? html`<span class="note">${options.note}</span>` : nothing}
      </div>
      <div class="control-value">
        ${
          state !== "ok"
            ? html`<span class="dim">${livenessText(hass, state)}</span>`
            : renderControl(hass, role, entity, options)
        }
        ${options.aside ? html`<span class="aside">${options.aside}</span>` : nothing}
      </div>
    </div>
  `;
}

function renderControl(
  hass: HomeAssistant,
  role: ResolvedRole,
  entity: HassEntity,
  options: RowOptions,
): TemplateResult {
  if (role.domain === "number" && role.writable) {
    return html`
      <ha-selector
        .hass=${hass}
        .selector=${numberSelector(entity, options.unit)}
        .value=${Number(entity.state)}
        @value-changed=${(event: CustomEvent) => {
          const next = Number((event.detail as { value: unknown }).value);
          if (!Number.isNaN(next) && next !== Number(entity.state)) {
            void writeNumber(hass, role.entityId, next);
          }
        }}
      ></ha-selector>
    `;
  }

  if ((role.domain === "switch" || role.domain === "light") && role.writable) {
    return html`
      <ha-switch
        .checked=${entity.state === "on"}
        @change=${(event: Event) => {
          void writeToggle(hass, role.entityId, (event.target as HTMLInputElement).checked);
        }}
      ></ha-switch>
    `;
  }

  if (role.domain === "binary_sensor") {
    return html`<span class="readout"
      >${localize(hass, entity.state === "on" ? "liveness.yes" : "liveness.no")}</span
    >`;
  }

  return html`<span class="readout"
    >${entity.state}${options.unit ? html` ${options.unit}` : nothing}</span
  >`;
}
