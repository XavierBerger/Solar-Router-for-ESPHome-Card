import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PACKAGES } from "../../src/detect/packages";
import { LANGUAGES, localize } from "../../src/localize/localize";
import en from "../../src/localize/en.json";
import fr from "../../src/localize/fr.json";
import { CONTROL_SECTIONS, rolesOf } from "../../src/sections/controls";
import { DIAGNOSTIC_GROUPS } from "../../src/sections/advanced";
import type { PackageId } from "../../src/detect/types";

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

describe("the translations", () => {
  it("cover the same keys in every language", () => {
    const reference = Object.keys(en).sort();
    for (const [language, table] of Object.entries(LANGUAGES)) {
      expect(Object.keys(table).sort(), `${language} keys`).toEqual(reference);
    }
  });

  it("keep the same placeholders in every language", () => {
    // A translation that drops `{version}` silently loses the number it was
    // meant to show, which no type check would catch.
    for (const [key, text] of Object.entries(en)) {
      for (const [language, table] of Object.entries(LANGUAGES)) {
        expect(placeholders(table[key] ?? ""), `${language} ${key}`).toEqual(placeholders(text));
      }
    }
  });

  it("leaves no string empty", () => {
    for (const [language, table] of Object.entries(LANGUAGES)) {
      for (const [key, text] of Object.entries(table)) {
        expect(text.trim(), `${language} ${key}`).not.toBe("");
      }
    }
  });

  it("is really translated, not copied", () => {
    // Product names are the same in both on purpose; most prose is not.
    const identical = Object.keys(en).filter(
      (key) => fr[key as keyof typeof fr] === en[key as keyof typeof en],
    );
    expect(identical.length).toBeLessThan(Object.keys(en).length / 4);
  });
});

describe("choosing a language", () => {
  it("follows the Home Assistant profile", () => {
    expect(localize({ language: "fr" }, "card.reload")).toBe("Recharger");
    expect(localize({ language: "en" }, "card.reload")).toBe("Reload");
  });

  it("treats a regional tag as its base language", () => {
    expect(localize({ language: "fr-CA" }, "card.reload")).toBe("Recharger");
    expect(localize({ language: "FR-fr" }, "card.reload")).toBe("Recharger");
  });

  it("falls back to English for a language it does not ship", () => {
    expect(localize({ language: "de" }, "card.reload")).toBe("Reload");
    expect(localize(undefined, "card.reload")).toBe("Reload");
  });

  it("substitutes placeholders, and leaves unknown ones alone", () => {
    expect(localize({ language: "en" }, "card.modules", { count: 7 })).toBe("Modules (7)");
    expect(localize({ language: "en" }, "card.modules")).toBe("Modules ({count})");
  });

  it("returns the key itself when there is no string, rather than blank", () => {
    expect(localize({ language: "fr" }, "no.such.key")).toBe("no.such.key");
  });
});

describe("every string the card reaches for exists", () => {
  it("has a label for every control role", () => {
    const roles = [...CONTROL_SECTIONS.flatMap((section) => rolesOf(section)), "activate"];
    for (const role of roles) {
      expect(Object.keys(en)).toContain(`role.${role}`);
    }
  });

  it("has a title for every control section", () => {
    for (const section of CONTROL_SECTIONS) {
      expect(Object.keys(en)).toContain(`section.${section}`);
    }
  });

  it("has a name for every one of the twenty-six packages", () => {
    for (const id of Object.keys(PACKAGES) as PackageId[]) {
      expect(Object.keys(en)).toContain(`package.${id}`);
    }
  });

  it("has a heading for every diagnostic group", () => {
    for (const owner of DIAGNOSTIC_GROUPS) {
      expect(Object.keys(en)).toContain(`group.${owner}`);
    }
  });

  it("has no key the source never uses", () => {
    // A stale key is a translation someone maintains for nothing. Keys built
    // by interpolation are matched on their prefix.
    const sources = readdirSync(new URL("../../src", import.meta.url), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`, "utf8"))
      .join("\n");

    // Keys the code builds by interpolation — `` `role.${role}` `` — cannot be
    // found literally, so collect their prefixes from the source itself rather
    // than listing them here, where the list would quietly go stale.
    const dynamic = [...sources.matchAll(/`([a-z_]+)\.\$\{/g)].map((match) => `${match[1]}.`);
    expect(dynamic.length).toBeGreaterThan(0);

    for (const key of Object.keys(en)) {
      if (dynamic.some((prefix) => key.startsWith(prefix))) {
        continue;
      }
      expect(sources, key).toContain(`"${key}"`);
    }
  });
});
