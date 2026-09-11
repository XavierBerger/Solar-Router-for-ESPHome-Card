/**
 * Translation.
 *
 * Home Assistant already knows the user's language, so the card follows the
 * profile rather than adding a setting of its own. English is the fallback and
 * the source of truth: a key missing from a translation falls back rather than
 * rendering blank, which is how a half-finished translation stays usable.
 */

import en from "./en.json";
import fr from "./fr.json";

import type { HomeAssistant } from "../types/home-assistant";

const TRANSLATIONS: Record<string, Record<string, string>> = { en, fr };

/** `fr-FR`, `fr-ca` and `fr` all mean French here. */
function languageOf(hass: Pick<HomeAssistant, "language"> | undefined): string {
  const tag = (hass?.language ?? "en").toLowerCase();
  const base = tag.split("-", 1)[0];
  return TRANSLATIONS[base] ? base : "en";
}

/**
 * Look up `key`, substituting `{placeholders}`.
 *
 * An unknown key returns the key itself. That is deliberately visible: a
 * missing string should look wrong in development rather than disappear.
 */
export function localize(
  hass: Pick<HomeAssistant, "language"> | undefined,
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const language = languageOf(hass);
  const text = TRANSLATIONS[language][key] ?? en[key as keyof typeof en] ?? key;
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** The languages the card ships. Exported for the tests. */
export const LANGUAGES = TRANSLATIONS;
