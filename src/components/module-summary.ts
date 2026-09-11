/**
 * What a router is made of, rendered the same way wherever it is shown.
 *
 * The card shows this in its Advanced section and the GUI editor shows it under
 * the device picker, where it is the feedback that tells a user their router
 * was recognised. One implementation, so the two cannot drift apart.
 */

import { html, nothing, type TemplateResult } from "lit";

import { PACKAGES, compareVersions, readVersion } from "../detect/packages";
import type {
  DeclaredPackage,
  DetectionWarning,
  PackageCategory,
  RouterProfile,
} from "../detect/types";

export const CATEGORY_LABELS: Record<PackageCategory, string> = {
  power_meter: "Power meter",
  engine: "Engine",
  regulator: "Regulator",
  energy_counter: "Energy counter",
  temperature: "Temperature",
  scheduler: "Scheduler",
  system: "System",
};

/** A package's name, with its instance when it is one of several. */
export function packageLabel(declared: DeclaredPackage): string {
  const label = PACKAGES[declared.id].label;
  return declared.instance ? `${label} ${declared.instance}` : label;
}

/**
 * The highest version currently published.
 *
 * Read from the states rather than taken from `profile.packagesVersion`,
 * because the profile is built from the registry alone and so carries no
 * version at all. It is a lower bound on the installed release — a release only
 * raises the packages it touched — which is why callers label it `≥`.
 */
export function highestVersion(
  profile: RouterProfile,
  states: Readonly<Record<string, { readonly state: string }>>,
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

/**
 * Engine, measurement source and regulators.
 *
 * Regulators are joined rather than picked: a router can drive a triac and
 * three mechanical relays at once, so there is no single "the" regulator.
 */
export function hardwareRows(profile: RouterProfile): [string, string][] {
  const meter = profile.packages.find(
    (declared) =>
      PACKAGES[declared.id].category === "power_meter" && !PACKAGES[declared.id].implicit,
  );
  const rows: [string, string][] = [];
  if (profile.engine) {
    rows.push(["Engine", PACKAGES[profile.engine].label]);
  }
  if (meter) {
    rows.push(["Power meter", PACKAGES[meter.id].label]);
  }
  if (profile.regulators.length > 0) {
    rows.push(["Regulator", profile.regulators.map(packageLabel).join(" · ")]);
  }
  return rows;
}

/**
 * A warning as a sentence.
 *
 * The detection layer emits codes rather than prose so this stays the only
 * place that writes English, which is what phase 3's translation will hook
 * into.
 */
export function warningText(warning: DetectionWarning): string {
  switch (warning.code) {
    case "engine_leaf_missing":
      return "An engine is loaded but none of the engine packages declares a version. Your packages are probably mid-update.";
    case "engine_not_declared":
      return "This device behaves like a router but declares no engine package.";
    case "multiple_engines":
      return `Two engine packages are declared (${warning.engines.join(", ")}). The card uses the most specific one.`;
    case "version_format_unexpected":
      return `${warning.entityId} does not publish a plain version number. The card read it anyway, but the firmware may have changed format.`;
    case "version_name_case_mismatch":
      return `A package named "${warning.name}" differs from the catalogue only by capitalisation, so it was ignored.`;
    case "override_unknown_role":
      return `The configuration pins a role the card does not know: "${warning.key}".`;
    case "override_off_device":
      return `The configuration pins ${warning.entityId} for "${warning.role}", which is not on this device.`;
  }
}

export function renderHardware(profile: RouterProfile): TemplateResult | typeof nothing {
  const rows = hardwareRows(profile);
  if (rows.length === 0) {
    return nothing;
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

export interface ModuleListOptions {
  /** Show the `*_common` packages, which are pulled in rather than chosen. */
  readonly showInternal: boolean;
  readonly onShowInternal: () => void;
}

/** The package list, grouped by category, with each declared version. */
export function renderModuleList(
  profile: RouterProfile,
  states: Readonly<Record<string, { readonly state: string }>>,
  options: ModuleListOptions,
): TemplateResult {
  const shown = profile.packages.filter(
    (declared) => options.showInternal || !PACKAGES[declared.id].implicit,
  );
  const internalCount = profile.packages.length - shown.length;
  let lastCategory: PackageCategory | undefined;

  return html`
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
              ${packageLabel(declared)}
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
              <button class="link" @click=${options.onShowInternal}>
                Show ${internalCount} internal package${internalCount > 1 ? "s" : ""}
              </button>
            `
          : nothing
      }
    </div>
  `;
}

/** The same list, folded away behind a summary line. Used by the card. */
export function renderModuleFold(
  profile: RouterProfile,
  states: Readonly<Record<string, { readonly state: string }>>,
  options: ModuleListOptions,
): TemplateResult {
  const bound = highestVersion(profile, states);
  return html`
    <details class="modules">
      <summary>
        Modules (${profile.packages.length})
        ${bound ? html`<span class="version">Packages ≥ ${bound}</span>` : nothing}
      </summary>
      ${renderModuleList(profile, states, options)}
    </details>
  `;
}
