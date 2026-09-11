import { describe, expect, it } from "vitest";

import { liveness, livenessText } from "../../src/components/control-row";
import { DIAGNOSTIC_GROUPS } from "../../src/sections/advanced";
import { CONTROL_SECTIONS, ROLE_LABELS, labelFor, rolesOf } from "../../src/sections/controls";
import { CATALOG } from "../../src/detect/catalog";
import { detectRouter } from "../../src/detect/detect";
import type { Role, RouterProfile } from "../../src/detect/types";
import { loadFixture, toEntities, toStates, type Fixture } from "../fixtures/load";

function profileOf(fixture: Fixture): RouterProfile {
  return detectRouter(fixture.device.id, toEntities(fixture), { states: toStates(fixture) });
}

const REAL = [
  "engine_1dimmer_fronius",
  "engine_1dimmer_2switches",
  "engine_1dimmer_2switches_1bypass",
  "engine_1dimmer_ds18b20_counter",
  "engine_1dimmer_scheduler",
  "engine_1dimmer_em3",
  "engine_1dimmer_jsy_debug",
  "engine_1dimmer_1bypass",
  "engine_1switch_ha_limiter",
  "proxy_only",
  "engine_1dimmer_fan",
] as const;

describe("the sections come from the catalogue", () => {
  it("lists a section's roles without hard-coding them", () => {
    expect(rolesOf("routing")).toEqual(["router_level", "target_grid_exchange"]);
    expect(rolesOf("fan")).toEqual(["fan_start_temperature", "fan_stop_temperature"]);
  });

  it("claims every role of every control section", () => {
    const claimed = new Set(CONTROL_SECTIONS.flatMap((section) => rolesOf(section.id)));
    const declared = (Object.keys(CATALOG) as Role[]).filter((role) =>
      CONTROL_SECTIONS.some((section) => CATALOG[role].section === section.id),
    );
    expect([...claimed].sort()).toEqual(declared.sort());
  });

  it("never shows the same role in two sections", () => {
    const seen = new Set<Role>();
    for (const section of CONTROL_SECTIONS) {
      for (const role of rolesOf(section.id)) {
        expect(seen.has(role)).toBe(false);
        seen.add(role);
      }
    }
  });
});

describe("the labels", () => {
  it("are written out for every control, never inherited", () => {
    // The firmware's `name:` strings are matching keys, not interface copy, so
    // every role the user can act on carries a label of its own. Comparing the
    // strings would not catch a gap: a few labels legitimately read the same as
    // the firmware name, so what matters is that the entry exists.
    const roles = CONTROL_SECTIONS.flatMap((section) => rolesOf(section.id));
    for (const role of [...roles, "activate" as Role]) {
      expect(Object.keys(ROLE_LABELS)).toContain(role);
    }
  });

  it("never leaks the known firmware typo", () => {
    const all = (Object.keys(CATALOG) as Role[]).map(labelFor).join(" ");
    expect(all).not.toContain("Realy");
  });
});

describe("every control section is reachable", () => {
  const profiles = REAL.map((name) => profileOf(loadFixture(name)));

  it.each(CONTROL_SECTIONS.map((s) => s.id))(
    "%s resolves on at least one real router",
    (section) => {
      const roles = rolesOf(section);
      const reachable = profiles.some((profile) => roles.some((role) => profile.roles[role]));
      expect(reachable).toBe(true);
    },
  );

  it("gives a progressive router its routing section and no on/off section", () => {
    const profile = profileOf(loadFixture("engine_1dimmer_fronius"));
    expect(rolesOf("routing").some((role) => profile.roles[role])).toBe(true);
    expect(rolesOf("onoff").some((role) => profile.roles[role])).toBe(false);
  });

  it("gives an all-or-nothing router its on/off section", () => {
    const profile = profileOf(loadFixture("engine_1switch_ha_limiter"));
    expect(rolesOf("onoff").some((role) => profile.roles[role])).toBe(true);
  });

  it("gives a power meter proxy no control section at all", () => {
    const profile = profileOf(loadFixture("proxy_only"));
    for (const section of CONTROL_SECTIONS) {
      expect(rolesOf(section.id).some((role) => profile.roles[role])).toBe(false);
    }
  });
});

describe("the advanced section", () => {
  it("has a group for every diagnostic role, so none can vanish", () => {
    // A diagnostics role whose owner is missing from the groups would simply
    // not be rendered — no error, no gap, just gone.
    const grouped = new Set(DIAGNOSTIC_GROUPS.map((group) => group.owner));
    const owners = (Object.keys(CATALOG) as Role[])
      .filter((role) => CATALOG[role].section === "diagnostics")
      .map((role) => CATALOG[role].owner);
    for (const owner of new Set(owners)) {
      expect(grouped).toContain(owner);
    }
  });

  it("labels every control a user can act on in Advanced", () => {
    const advanced = (Object.keys(CATALOG) as Role[]).filter(
      (role) => CATALOG[role].section === "advanced",
    );
    expect(advanced.length).toBeGreaterThan(0);
    for (const role of advanced) {
      expect(Object.keys(ROLE_LABELS)).toContain(role);
    }
  });

  it("renders the regulator opening read-only when the engine publishes a sensor", () => {
    // engine_1dimmer makes it a number; the other dimmer engines a sensor.
    // Whichever resolved decides, which is why `writable` is carried through.
    for (const name of REAL) {
      const profile = profileOf(loadFixture(name));
      const role = profile.roles.regulator_opening;
      if (role) {
        expect(role.writable).toBe(role.domain === "number");
      }
    }
  });
});

describe("liveness", () => {
  it("separates the four cases a card must not blur", () => {
    expect(liveness(undefined)).toBe("missing");
    expect(liveness({ entity_id: "x", state: "unavailable" } as never)).toBe("unavailable");
    expect(liveness({ entity_id: "x", state: "unknown" } as never)).toBe("unknown");
    expect(liveness({ entity_id: "x", state: "" } as never)).toBe("unknown");
    expect(liveness({ entity_id: "x", state: "42" } as never)).toBe("ok");
  });

  it("has a word for each of them but silence for a healthy one", () => {
    expect(livenessText("ok")).toBe("");
    for (const state of ["unavailable", "unknown", "missing"] as const) {
      expect(livenessText(state).length).toBeGreaterThan(0);
    }
  });
});
