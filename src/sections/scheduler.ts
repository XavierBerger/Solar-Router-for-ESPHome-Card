/**
 * The scheduler sections — one per instance.
 *
 * Schedulers are the one part of the firmware that is multi-instance by design:
 * `scheduler_unique_id` defaults to `Forced`, and loading the package twice for
 * a day and a night window is documented. So these sections are enumerated from
 * what the device actually has, never assumed.
 */

import { html, nothing, type TemplateResult } from "lit";

import { liveness, renderControlRow, writeNumber } from "../components/control-row";
import type { ResolvedRole, SchedulerInstance, SchedulerRole } from "../detect/types";
import type { HomeAssistant } from "../types/home-assistant";

const LABELS: Record<SchedulerRole, string> = {
  activate: "Enabled",
  router_level: "Router level",
  checking_end_threshold: "End threshold",
  begin_hour: "Start",
  begin_minute: "Start",
  end_hour: "End",
  end_minute: "End",
};

function two(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Start and end as one time control each.
 *
 * The firmware exposes four numbers — an hour and a minute per edge — because
 * ESPHome has no time entity. Presenting them as four spinners would be
 * faithful and useless, so the card merges each pair into Home Assistant's own
 * time selector and writes both numbers back on change.
 */
function renderTimeRow(
  hass: HomeAssistant,
  label: string,
  hour: ResolvedRole | undefined,
  minute: ResolvedRole | undefined,
): TemplateResult | typeof nothing {
  if (!hour || !minute) {
    // Half a pair says nothing useful; fall back to whichever exists as a
    // plain row rather than inventing a time.
    const single = hour ?? minute;
    return single ? renderControlRow(hass, single, { label }) : nothing;
  }

  const hourEntity = hass.states[hour.entityId];
  const minuteEntity = hass.states[minute.entityId];
  if (liveness(hourEntity) !== "ok" || liveness(minuteEntity) !== "ok") {
    return renderControlRow(hass, hour, { label });
  }

  const value = `${two(Number(hourEntity.state))}:${two(Number(minuteEntity.state))}:00`;

  return html`
    <div class="control-row">
      <div class="control-label"><span>${label}</span></div>
      <div class="control-value">
        <ha-selector
          .hass=${hass}
          .selector=${{ time: {} }}
          .value=${value}
          @value-changed=${(event: CustomEvent) => {
            const next = String((event.detail as { value: unknown }).value ?? "");
            const [h, m] = next.split(":").map(Number);
            if (Number.isNaN(h) || Number.isNaN(m)) {
              return;
            }
            if (h !== Number(hourEntity.state)) {
              void writeNumber(hass, hour.entityId, h);
            }
            if (m !== Number(minuteEntity.state)) {
              void writeNumber(hass, minute.entityId, m);
            }
          }}
        ></ha-selector>
      </div>
    </div>
  `;
}

function renderScheduler(
  instance: SchedulerInstance,
  hass: HomeAssistant,
): TemplateResult | typeof nothing {
  const { roles } = instance;
  const rows: (TemplateResult | typeof nothing)[] = [];

  if (roles.activate) {
    rows.push(renderControlRow(hass, roles.activate, { label: LABELS.activate }));
  }
  rows.push(renderTimeRow(hass, LABELS.begin_hour, roles.begin_hour, roles.begin_minute));
  rows.push(renderTimeRow(hass, LABELS.end_hour, roles.end_hour, roles.end_minute));
  if (roles.router_level) {
    rows.push(
      renderControlRow(hass, roles.router_level, { label: LABELS.router_level, unit: "%" }),
    );
  }
  if (roles.checking_end_threshold) {
    rows.push(
      renderControlRow(hass, roles.checking_end_threshold, {
        label: LABELS.checking_end_threshold,
      }),
    );
  }

  const shown = rows.filter((row) => row !== nothing);
  if (shown.length === 0) {
    return nothing;
  }

  return html`
    <div class="section">
      <div class="section-title">Scheduler “${instance.id}”</div>
      ${shown}
    </div>
  `;
}

export function renderSchedulerSections(
  schedulers: readonly SchedulerInstance[],
  hass: HomeAssistant,
): TemplateResult | typeof nothing {
  const sections = schedulers
    .map((instance) => renderScheduler(instance, hass))
    .filter((rendered) => rendered !== nothing);
  return sections.length > 0 ? html`${sections}` : nothing;
}
