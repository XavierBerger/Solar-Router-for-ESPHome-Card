/**
 * The Advanced section: fine adjustments, then diagnostics.
 *
 * Everything here is optional in the firmware. `hide_regulators` and
 * `hide_leds` default to hiding, and every JSY channel is `internal` by
 * default, so most routers show only a handful of these rows — and the ones
 * that are missing are missing on purpose. Nothing here is ever reported as
 * absent.
 */

import { html, nothing, type TemplateResult } from "lit";

import { renderControlRow } from "../components/control-row";
import { CATALOG } from "../detect/catalog";
import type { Role, RoleOwner, RouterProfile } from "../detect/types";
import type { HomeAssistant } from "../types/home-assistant";
import { labelFor } from "./controls";

/** Diagnostics grouped the way the firmware packages them. */
export const DIAGNOSTIC_GROUPS: readonly { readonly owner: RoleOwner; readonly title: string }[] = [
  { owner: "common", title: "Device" },
  { owner: "debug_sensors", title: "Debug sensors" },
  { owner: "power_meter_shelly_em3", title: "Shelly EM3 phases" },
  { owner: "jsy-mk-194t_common", title: "JSY-MK-194T" },
];

function rolesOfSection(section: "advanced" | "diagnostics"): Role[] {
  return (Object.keys(CATALOG) as Role[]).filter((role) => CATALOG[role].section === section);
}

function noteFor(role: Role, writable: boolean): string | undefined {
  if (role === "restart") {
    return "Restarts the router immediately";
  }
  if (role === "regulator_opening" && !writable) {
    // `engine_1dimmer` publishes this as a number and lets you drive the
    // regulator by hand; the other dimmer engines publish a sensor. Saying so
    // stops a read-only row from looking like a broken control.
    return "Read-only on this engine";
  }
  return undefined;
}

/** The fine adjustments: reactivities, regulator, diversion switches, LEDs. */
export function renderAdvancedControls(
  profile: RouterProfile,
  hass: HomeAssistant,
): TemplateResult | typeof nothing {
  const roles = rolesOfSection("advanced").filter((role) => profile.roles[role]);
  if (roles.length === 0) {
    return nothing;
  }

  return html`
    <div class="section">
      <div class="section-title">Fine adjustment</div>
      ${roles.map((role) => {
        const resolved = profile.roles[role];
        return resolved
          ? renderControlRow(hass, resolved, {
              label: labelFor(role),
              unit: CATALOG[role].unit,
              note: noteFor(role, resolved.writable),
            })
          : nothing;
      })}
    </div>
  `;
}

/**
 * The diagnostics, as readouts.
 *
 * Folded away and grouped by the package that publishes them, so a reader can
 * tell at a glance whether a value comes from the device itself, from the
 * debug package or from a meter.
 */
export function renderDiagnostics(
  profile: RouterProfile,
  hass: HomeAssistant,
): TemplateResult | typeof nothing {
  const present = rolesOfSection("diagnostics").filter((role) => profile.roles[role]);
  if (present.length === 0) {
    return nothing;
  }

  const groups = DIAGNOSTIC_GROUPS.map((group) => ({
    title: group.title,
    roles: present.filter((role) => CATALOG[role].owner === group.owner),
  })).filter((group) => group.roles.length > 0);

  return html`
    <details class="diagnostics">
      <summary>Diagnostics (${present.length})</summary>
      ${groups.map(
        (group) => html`
          <div class="section">
            <div class="section-title">${group.title}</div>
            ${group.roles.map((role) => {
              const resolved = profile.roles[role];
              return resolved
                ? renderControlRow(hass, resolved, {
                    label: labelFor(role),
                    unit: CATALOG[role].unit,
                  })
                : nothing;
            })}
          </div>
        `,
      )}
    </details>
  `;
}
