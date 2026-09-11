/**
 * The control sections.
 *
 * Which roles belong to which section already lives in `catalog.ts`, so this
 * file adds order and titles and nothing else. Adding a control to the firmware
 * therefore means one catalogue entry, not an edit here as well.
 *
 * Every section degrades on its own: a role that did not resolve is skipped,
 * and a section with nothing left to show is not rendered. An absent entity is
 * never an error and never an empty box.
 */

import { html, nothing, type TemplateResult } from "lit";

import { CATALOG } from "../detect/catalog";
import type { Role, RouterProfile, SectionId } from "../detect/types";
import { localize } from "../localize/localize";
import type { HomeAssistant } from "../types/home-assistant";
import { liveness, renderControlRow } from "../components/control-row";

/** Control sections, in the order the card shows them. */
const SECTION_ORDER: readonly SectionId[] = [
  "routing",
  "onoff",
  "bypass",
  "energy",
  "temperature",
  "fan",
];

/** Roles of a section, in catalogue order. */
function rolesOf(section: SectionId): Role[] {
  return (Object.keys(CATALOG) as Role[]).filter((role) => CATALOG[role].section === section);
}

/**
 * Notes the firmware makes necessary.
 *
 * Each of these is a behaviour a user would otherwise discover the hard way.
 */
function noteFor(role: Role, profile: RouterProfile, hass: HomeAssistant): string | undefined {
  if (CATALOG[role].resetsOnRestart) {
    return localize(hass, "note.resets_on_restart");
  }
  if (role === "router_level") {
    const activate = profile.roles.activate;
    const on = activate && hass.states[activate.entityId]?.state === "on";
    // While routing is active the engine overwrites this every cycle, so a
    // value set by hand will not stick. Say so rather than let it look broken.
    return on ? localize(hass, "note.router_level_driven") : undefined;
  }
  return undefined;
}

/** The countdown belonging to a setpoint, when it resolved and is running. */
function asideFor(role: Role, profile: RouterProfile, hass: HomeAssistant): string | undefined {
  const paired = CATALOG[role].pairedWith;
  if (!paired) {
    return undefined;
  }
  const resolved = profile.roles[paired];
  if (!resolved) {
    return undefined;
  }
  const entity = hass.states[resolved.entityId];
  if (liveness(entity) !== "ok") {
    return undefined;
  }
  return localize(hass, "liveness.left", { value: entity.state });
}

function renderSection(
  section: SectionId,
  profile: RouterProfile,
  hass: HomeAssistant,
): TemplateResult | typeof nothing {
  const roles = rolesOf(section).filter((role) => profile.roles[role]);
  if (roles.length === 0) {
    return nothing;
  }

  return html`
    <div class="section">
      <div class="section-title">${localize(hass, `section.${section}`)}</div>
      ${roles.map((role) => {
        const resolved = profile.roles[role];
        // `roles` was filtered on exactly this, but the compiler cannot see it.
        return resolved
          ? renderControlRow(hass, resolved, {
              label: labelFor(hass, role),
              unit: CATALOG[role].unit,
              note: noteFor(role, profile, hass),
              aside: asideFor(role, profile, hass),
            })
          : nothing;
      })}
    </div>
  `;
}

/**
 * The label the card puts on a role.
 *
 * Deliberately not the firmware's `name:`. Those are matching keys, not user
 * interface copy — one of them carries a typo that must never be corrected, and
 * another is the only one not capitalised. Phase 3's translation keys off the
 * role instead.
 */
const LABELS: Partial<Record<Role, string>> = {
  activate: "Solar routing",
  router_level: "Router level",
  target_grid_exchange: "Target grid exchange",
  start_power_level: "Start above",
  stop_power_level: "Stop below",
  start_tempo: "Start delay",
  stop_tempo: "Stop delay",
  bypass_relay: "Bypass engaged",
  bypass_tempo: "Bypass duration",
  bypass_tempo_countdown: "Bypass remaining",
  load_power: "Load power",
  stop_temperature: "Stop at",
  restart_temperature: "Restart at",
  used_for_cooling: "Used for cooling",
  fan_start_temperature: "Start fan at",
  fan_stop_temperature: "Stop fan at",
  // Advanced and live roles whose firmware name cannot be shown as-is:
  // `Energy divertion Realy 3 Bypass` carries a typo that is public API and
  // must stay misspelled in the catalogue, and `safety_temperature` is the one
  // name the firmware left uncapitalised.
  up_reactivity: "Up reactivity",
  down_reactivity: "Down reactivity",
  regulator_opening: "Regulator opening",
  relay_1_countdown: "Relay 1 countdown",
  relay_2_countdown: "Relay 2 countdown",
  relay_3_countdown: "Relay 3 countdown",
  green_led: "Green LED",
  yellow_led: "Yellow LED",
  restart: "Restart",
  energy_divertion: "Diverting energy",
  energy_divertion_relay_1: "Diverting to relay 1",
  energy_divertion_relay_2: "Diverting to relay 2",
  energy_divertion_relay_3_bypass: "Diverting to bypass relay",
  safety_temperature: "Temperature",
};

function labelFor(hass: Pick<HomeAssistant, "language"> | undefined, role: Role): string {
  const translated = localize(hass, `role.${role}`);
  // An untranslated diagnostic keeps the firmware's own name, which reads fine
  // for the likes of "Heap Free". Controls never fall through: a test pins it.
  return translated === `role.${role}` ? (LABELS[role] ?? CATALOG[role].name) : translated;
}

/** The main switch, which is the card's primary affordance. */
export function renderHeaderControl(
  profile: RouterProfile,
  hass: HomeAssistant,
): TemplateResult | typeof nothing {
  const activate = profile.roles.activate;
  if (!activate) {
    return nothing;
  }
  return html`
    <div class="section">
      ${renderControlRow(hass, activate, { label: labelFor(hass, "activate") })}
    </div>
  `;
}

export function renderControlSections(
  profile: RouterProfile,
  hass: HomeAssistant,
): TemplateResult | typeof nothing {
  const sections = SECTION_ORDER.map((section) => renderSection(section, profile, hass)).filter(
    (rendered) => rendered !== nothing,
  );
  if (sections.length === 0) {
    return nothing;
  }
  return html`${sections}`;
}

/** Exported for the tests, which assert the catalogue drives the sections. */
export const CONTROL_SECTIONS = SECTION_ORDER;
export const ROLE_LABELS = LABELS;
export { rolesOf, labelFor };
