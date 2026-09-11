/**
 * The live band: what the router is doing right now.
 *
 * A gauge, four readings and two conditional banners. Everything here is a
 * readout — the controls live below — so the job is to be readable at a glance
 * and to never show a stale number as if it were current.
 */

import { html, nothing, type TemplateResult } from "lit";

import { liveness, livenessText } from "../components/control-row";
import { renderGauge } from "../components/gauge";
import type { ResolvedRole, RouterProfile, SchedulerInstance } from "../detect/types";
import { localize } from "../localize/localize";
import type { HomeAssistant } from "../types/home-assistant";

/**
 * Which way the power is flowing.
 *
 * The firmware's own comment settles the convention: "Energy export is
 * negative" (`solar_router/engine_1switch.yaml`). A negative `Real Power` is
 * surplus going to the grid, which is exactly what the router exists to catch.
 */
export type Direction = "import" | "export" | "balanced";

export function powerDirection(watts: number): Direction {
  if (watts <= -1) {
    return "export";
  }
  if (watts >= 1) {
    return "import";
  }
  return "balanced";
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function numberState(hass: HomeAssistant, role: ResolvedRole | undefined): number | null {
  if (!role) {
    return null;
  }
  const entity = hass.states[role.entityId];
  if (liveness(entity) !== "ok") {
    return null;
  }
  const value = Number(entity.state);
  return Number.isNaN(value) ? null : value;
}

export interface OpenWindow {
  readonly id: string;
  /** End of the window, as `HH:MM`. */
  readonly until: string;
}

/**
 * The scheduler window currently open, if any.
 *
 * A window that crosses midnight is normal — a night slot is the obvious use —
 * so the comparison wraps rather than assuming begin is before end.
 */
export function openWindow(
  hass: HomeAssistant,
  scheduler: SchedulerInstance,
  now: Date,
): OpenWindow | null {
  const enabled = scheduler.roles.activate;
  if (!enabled || hass.states[enabled.entityId]?.state !== "on") {
    return null;
  }

  const beginHour = numberState(hass, scheduler.roles.begin_hour);
  const beginMinute = numberState(hass, scheduler.roles.begin_minute);
  const endHour = numberState(hass, scheduler.roles.end_hour);
  const endMinute = numberState(hass, scheduler.roles.end_minute);
  if (beginHour === null || beginMinute === null || endHour === null || endMinute === null) {
    return null;
  }

  const begin = minutesOfDay(beginHour, beginMinute);
  const end = minutesOfDay(endHour, endMinute);
  const current = minutesOfDay(now.getHours(), now.getMinutes());

  const open = begin <= end ? current >= begin && current < end : current >= begin || current < end;
  if (!open) {
    return null;
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  return { id: scheduler.id, until: `${pad(endHour)}:${pad(endMinute)}` };
}

function reading(
  hass: HomeAssistant,
  label: string,
  role: ResolvedRole | undefined,
  unit: string,
  extra?: string,
): TemplateResult | typeof nothing {
  if (!role) {
    return nothing;
  }
  const entity = hass.states[role.entityId];
  const state = liveness(entity);
  return html`
    <div class="reading">
      <span class="reading-label">${label}</span>
      <span class="reading-value">
        ${
          state === "ok"
            ? html`${extra ? html`<span class="arrow">${extra}</span>` : nothing}
              ${Math.round(Number(entity.state) * 10) / 10} ${unit}`
            : html`<span class="dim">${livenessText(hass, state)}</span>`
        }
      </span>
    </div>
  `;
}

/** The safety limiter has cut in — the one thing that must interrupt reading. */
function renderSafetyBanner(
  profile: RouterProfile,
  hass: HomeAssistant,
): TemplateResult | typeof nothing {
  const reached = profile.roles.safety_limit_reached;
  if (!reached || hass.states[reached.entityId]?.state !== "on") {
    return nothing;
  }
  const temperature = numberState(hass, profile.roles.safety_temperature);
  return html`
    <div class="banner alert">
      <ha-icon icon="mdi:thermometer-alert"></ha-icon>
      <span>
        ${
          temperature === null
            ? localize(hass, "live.safety_reached")
            : localize(hass, "live.safety_reached_at", { temperature: Math.round(temperature) })
        }
      </span>
    </div>
  `;
}

function renderSchedulerBanner(
  profile: RouterProfile,
  hass: HomeAssistant,
  now: Date,
): TemplateResult | typeof nothing {
  const open = profile.schedulers
    .map((scheduler) => openWindow(hass, scheduler, now))
    .find((window): window is OpenWindow => window !== null);
  if (!open) {
    return nothing;
  }
  return html`
    <div class="banner info">
      <ha-icon icon="mdi:clock-outline"></ha-icon>
      <span>${localize(hass, "live.scheduler_open", { id: open.id, until: open.until })}</span>
    </div>
  `;
}

export function renderLive(
  profile: RouterProfile,
  hass: HomeAssistant,
  now: Date = new Date(),
): TemplateResult | typeof nothing {
  const level = numberState(hass, profile.roles.router_level);
  const onOff = profile.engine === "engine_1switch";
  const realPower = profile.roles.real_power;
  const watts = numberState(hass, realPower);
  const direction = watts === null ? null : powerDirection(watts);

  const readings = [
    reading(
      hass,
      localize(hass, "live.grid"),
      realPower,
      "W",
      direction === "export" ? "←" : direction === "import" ? "→" : "",
    ),
    reading(hass, localize(hass, "live.consumption"), profile.roles.consumption, "W"),
    reading(hass, localize(hass, "live.diverted"), profile.roles.power_divertion, "W"),
    reading(
      hass,
      localize(hass, "live.today"),
      profile.roles.total_daily_energy_diverted ?? profile.roles.total_energy_diverted,
      "kWh",
    ),
  ].filter((row) => row !== nothing);

  // The all-or-nothing engine has no level to speak of: its `Router Level` is
  // only ever 0 or 100, so a percentage would suggest a precision it lacks.
  const gauge =
    level === null && !profile.roles.router_level
      ? nothing
      : renderGauge({
          percent: onOff ? (level === null ? null : level >= 50 ? 100 : 0) : level,
          caption: localize(hass, "live.routing"),
          text: onOff
            ? level === null
              ? undefined
              : localize(hass, level >= 50 ? "live.on" : "live.off")
            : undefined,
        });

  const countdowns = onOff
    ? [
        reading(hass, localize(hass, "live.starting_in"), profile.roles.start_tempo_countdown, "s"),
        reading(hass, localize(hass, "live.stopping_in"), profile.roles.stop_tempo_countdown, "s"),
      ].filter((row) => row !== nothing)
    : [];

  if (gauge === nothing && readings.length === 0) {
    return nothing;
  }

  return html`
    <div class="live">
      ${gauge}
      <div class="readings">${readings}${countdowns}</div>
    </div>
    ${renderSafetyBanner(profile, hass)} ${renderSchedulerBanner(profile, hass, now)}
  `;
}
