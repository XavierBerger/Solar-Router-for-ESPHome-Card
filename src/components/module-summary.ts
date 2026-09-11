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
import { localize } from "../localize/localize";
import type { HomeAssistant } from "../types/home-assistant";

/** Anything that only needs the language, so tests can pass a bare object. */
type Lang = Pick<HomeAssistant, "language"> | undefined;

/**
 * A package's name, with its instance when it is one of several.
 *
 * The catalogue's `label` is the English fallback; the translation wins when
 * there is one. Hardware names such as "Fronius Smart Meter" are the same in
 * both, which is correct — they are product names, not prose.
 */
export function packageLabel(hass: Lang, declared: DeclaredPackage): string {
  const label = localize(hass, `package.${declared.id}`);
  const text = label === `package.${declared.id}` ? PACKAGES[declared.id].label : label;
  return declared.instance ? `${text} ${declared.instance}` : text;
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
export function hardwareRows(hass: Lang, profile: RouterProfile): [string, string][] {
  const meter = profile.packages.find(
    (declared) =>
      PACKAGES[declared.id].category === "power_meter" && !PACKAGES[declared.id].implicit,
  );
  const rows: [string, string][] = [];
  if (profile.engine) {
    rows.push([
      localize(hass, "hardware.engine"),
      packageLabel(hass, { id: profile.engine, instance: "" } as DeclaredPackage),
    ]);
  }
  if (meter) {
    rows.push([localize(hass, "hardware.power_meter"), packageLabel(hass, meter)]);
  }
  if (profile.regulators.length > 0) {
    rows.push([
      localize(hass, "hardware.regulator"),
      profile.regulators.map((regulator) => packageLabel(hass, regulator)).join(" · "),
    ]);
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
export function warningText(hass: Lang, warning: DetectionWarning): string {
  const key = `warning.${warning.code}`;
  switch (warning.code) {
    case "multiple_engines":
      return localize(hass, key, { engines: warning.engines.join(", ") });
    case "version_format_unexpected":
      return localize(hass, key, { entityId: warning.entityId });
    case "version_name_case_mismatch":
      return localize(hass, key, { name: warning.name });
    case "override_unknown_role":
      return localize(hass, key, { key: warning.key });
    case "override_off_device":
      return localize(hass, key, { entityId: warning.entityId, role: warning.role });
    default:
      return localize(hass, key);
  }
}

export function renderHardware(
  hass: Lang,
  profile: RouterProfile,
): TemplateResult | typeof nothing {
  const rows = hardwareRows(hass, profile);
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
  hass: Lang,
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
        const heading = category !== lastCategory ? localize(hass, `category.${category}`) : "";
        lastCategory = category;
        const { version, versionState } = readVersion(states[declared.entityId]?.state);
        return html`
          <div class="entity">
            <span class="domain">${heading}</span>
            <span>
              <ha-icon icon=${PACKAGES[declared.id].icon}></ha-icon>
              ${packageLabel(hass, declared)}
            </span>
            <span
              class="value"
              title=${versionState === "pending" ? localize(hass, "card.version_pending") : ""}
              >${version ?? (versionState === "pending" ? "…" : "—")}</span
            >
          </div>
        `;
      })}
      ${
        internalCount > 0
          ? html`
              <button class="link" @click=${options.onShowInternal}>
                ${
                  internalCount > 1
                    ? localize(hass, "card.show_internal", { count: internalCount })
                    : localize(hass, "card.show_internal_one")
                }
              </button>
            `
          : nothing
      }
    </div>
  `;
}

/** The same list, folded away behind a summary line. Used by the card. */
export function renderModuleFold(
  hass: Lang,
  profile: RouterProfile,
  states: Readonly<Record<string, { readonly state: string }>>,
  options: ModuleListOptions,
): TemplateResult {
  const bound = highestVersion(profile, states);
  return html`
    <details class="modules">
      <summary>
        ${localize(hass, "card.modules", { count: profile.packages.length })}
        ${
          bound
            ? html`<span class="version"
                >${localize(hass, "card.packages_at_least", { version: bound })}</span
              >`
            : nothing
        }
      </summary>
      ${renderModuleList(hass, profile, states, options)}
    </details>
  `;
}
