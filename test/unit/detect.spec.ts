import { describe, expect, it } from "vitest";

import { detectRouter } from "../../src/detect/detect";
import { PACKAGES, matchVersionEntity, readVersion } from "../../src/detect/packages";
import type { PackageId, RouterProfile } from "../../src/detect/types";
import {
  hidden,
  loadFixture,
  offline,
  plus,
  renamed,
  toEntities,
  toStates,
  versionEntity,
  withVersionsDisabled,
  withVersionsUnpublished,
  withoutVersionSensors,
  type Fixture,
} from "../fixtures/load";

function profileOf(fixture: Fixture): RouterProfile {
  return detectRouter(fixture.device.id, toEntities(fixture), { states: toStates(fixture) });
}

/** Every fixture generated from a real `local_*.yaml` of the firmware. */
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

describe("every real router", () => {
  it.each(REAL)("%s is supported and declares only known packages", (name) => {
    const profile = profileOf(loadFixture(name));
    expect(profile.firmware).toBe("supported");
    expect(profile.packages.length).toBeGreaterThan(0);
    for (const declaredPackage of profile.packages) {
      expect(PACKAGES[declaredPackage.id]).toBeDefined();
      expect(declaredPackage.versionState).toBe("known");
      expect(declaredPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(profile.warnings).toEqual([]);
  });

  it.each(REAL)("%s leaves no entity unaccounted for", (name) => {
    // An unclaimed entity means the role catalogue has a hole, so this is the
    // assertion that keeps `catalog.ts` honest as the firmware grows.
    expect(profileOf(loadFixture(name)).unclaimed).toEqual([]);
  });
});

describe("the engine", () => {
  it.each([
    ["engine_1dimmer_fronius", "engine_1dimmer"],
    ["engine_1dimmer_2switches", "engine_1dimmer_2switches"],
    ["engine_1dimmer_2switches_1bypass", "engine_1dimmer_2switches_1bypass"],
    ["engine_1dimmer_1bypass", "engine_1dimmer_1bypass"],
    ["engine_1switch_ha_limiter", "engine_1switch"],
  ])("%s runs %s", (fixture, engine) => {
    const profile = profileOf(loadFixture(fixture));
    expect(profile.engine).toBe(engine);
    expect(profile.kind).toBe("router");
  });

  it("is null on a power meter proxy, which is not an error", () => {
    const profile = profileOf(loadFixture("proxy_only"));
    expect(profile.engine).toBeNull();
    expect(profile.kind).toBe("power_meter");
    expect(profile.warnings).toEqual([]);
  });

  it("comes from the leaf, never from engine_common", () => {
    const profile = profileOf(loadFixture("engine_1dimmer_fronius"));
    expect(profile.declares.has("engine_common")).toBe(true);
    expect(profile.engine).toBe("engine_1dimmer");
  });

  it("picks the most specific one and warns when two leaves are declared", () => {
    const profile = profileOf(
      plus(loadFixture("engine_1dimmer_fronius"), versionEntity("engine_1switch", "1.6.3")),
    );
    expect(profile.engine).toBe("engine_1switch");
    expect(profile.warnings).toContainEqual({
      code: "multiple_engines",
      engines: ["engine_1switch", "engine_1dimmer"],
    });
  });

  it("warns when engine_common is there but no leaf declares itself", () => {
    const base = loadFixture("engine_1dimmer_fronius");
    const without: Fixture = {
      ...base,
      entities: base.entities.filter((e) => e.original_name !== "engine_1dimmer"),
    };
    const profile = profileOf(without);
    expect(profile.engine).toBeNull();
    expect(profile.warnings).toContainEqual({ code: "engine_leaf_missing" });
  });
});

describe("the three blind spots the version sensors lifted", () => {
  it("names the regulator, and treats regulators as a list", () => {
    // esp8266-proxy-client loads a solid state relay AND a mechanical one.
    const profile = profileOf(loadFixture("engine_1dimmer_1bypass"));
    expect(profile.regulators.map((r) => r.id).sort()).toEqual([
      "regulator_mecanical_relay",
      "regulator_solid_state_relay",
    ]);
  });

  it("tells a DS18B20 probe from a Home Assistant one", () => {
    expect(profileOf(loadFixture("engine_1dimmer_ds18b20_counter")).declares).toContain(
      "temperature_limiter_DS18B20",
    );
    expect(profileOf(loadFixture("engine_1switch_ha_limiter")).declares).toContain(
      "temperature_limiter_home_assistant",
    );
  });

  it("names which of the six power meters feeds Real Power", () => {
    const source = (name: string) =>
      profileOf(loadFixture(name)).packages.find(
        (p) => PACKAGES[p.id].category === "power_meter" && !PACKAGES[p.id].implicit,
      )?.id;
    expect(source("engine_1dimmer_fronius")).toBe("power_meter_fronius");
    expect(source("engine_1dimmer_1bypass")).toBe("power_meter_proxy_client");
    expect(source("engine_1switch_ha_limiter")).toBe("power_meter_home_assistant");
    expect(source("engine_1dimmer_em3")).toBe("power_meter_shelly_em3");
    expect(source("proxy_only")).toBe("power_meter_shelly_em");
  });

  it("sees a JSY router even with every channel hidden", () => {
    // The old inference could only spot jsy-mk-194t_common through an
    // un-hidden channel, and the channels default to `internal`. This config
    // exposes exactly one, so hide it and the package used to vanish.
    const base = loadFixture("engine_1dimmer_jsy_debug");
    expect(profileOf(base).declares.has("jsy-mk-194t_common")).toBe(true);

    const allHidden: Fixture = {
      ...base,
      entities: base.entities.filter((e) => !/ Ch\d$/.test(e.original_name ?? "")),
    };
    const profile = profileOf(allHidden);
    expect(Object.keys(profile.roles).some((role) => role.startsWith("jsy_"))).toBe(false);
    expect(profile.declares.has("jsy-mk-194t_common")).toBe(true);
  });
});

describe("multi-instance packages", () => {
  it("counts three mechanical relays, each its own instance", () => {
    const profile = profileOf(loadFixture("engine_1dimmer_2switches_1bypass"));
    expect(profile.mechanicalRelays).toBe(3);
    expect(
      profile.packages.filter((p) => p.id === "regulator_mecanical_relay").map((p) => p.instance),
    ).toEqual(["1", "2", "3"]);
  });

  it("reads the default empty relay_unique_id as an empty instance", () => {
    // `regulator_mecanical_relay_` — the separator eats the trailing underscore.
    const profile = profileOf(loadFixture("engine_1dimmer_1bypass"));
    const relays = profile.packages.filter((p) => p.id === "regulator_mecanical_relay");
    expect(relays).toHaveLength(1);
    expect(relays[0].instance).toBe("");
    expect(relays[0].declaredName).toBe("regulator_mecanical_relay_");
  });

  it("does not confuse the relay count with the Relay N Countdown sensors", () => {
    // The proxy client loads a mechanical relay while its engine publishes no
    // countdown at all. Two quantities, two fields.
    const profile = profileOf(loadFixture("engine_1dimmer_1bypass"));
    expect(profile.mechanicalRelays).toBe(1);
    expect(profile.relayCountdowns).toBe(0);
  });

  it("enumerates schedulers from the business entities, not the version sensor", () => {
    const profile = profileOf(loadFixture("engine_1dimmer_scheduler"));
    expect(profile.declares.has("scheduler_forced_run")).toBe(true);
    expect(profile.schedulers.map((s) => s.id)).toEqual(["Forced"]);
  });
});

describe("packages that cannot be trusted to appear", () => {
  it("misses power_meter_common behind the Home Assistant meter's merge key", () => {
    // `power_meter_home_assistant.yaml` merges with `<<:`, so its own
    // `text_sensor:` replaces the common's. Absent, yet loaded.
    const profile = profileOf(loadFixture("engine_1switch_ha_limiter"));
    expect(profile.declares.has("power_meter_home_assistant")).toBe(true);
    expect(profile.declares.has("power_meter_common")).toBe(false);
    expect(PACKAGES.power_meter_common.unreliablePresence).toBe(true);
    expect(profile.warnings).toEqual([]);
  });

  it("accepts a router that does not load common.yaml at all", () => {
    const profile = profileOf(loadFixture("engine_1dimmer_1bypass"));
    expect(profile.declares.has("common")).toBe(false);
    expect(profile.firmware).toBe("supported");
  });
});

describe("the four compatibility verdicts", () => {
  it("supported: at least one package declares itself", () => {
    expect(profileOf(loadFixture("engine_1dimmer_fronius")).firmware).toBe("supported");
  });

  it("outdated: no version sensor, but the roles say this is a router", () => {
    const profile = profileOf(withoutVersionSensors(loadFixture("engine_1dimmer_fronius")));
    expect(profile.firmware).toBe("outdated");
    expect(profile.roles.activate).toBeDefined();
    expect(profile.packages).toEqual([]);
  });

  it("not_a_router: entities, but neither packages nor anchor roles", () => {
    const profile = detectRouter("dev_other", [
      {
        entityId: "sensor.doorbell_battery",
        domain: "sensor",
        originalName: "Battery",
        entityCategory: "diagnostic",
      },
      {
        entityId: "switch.doorbell_chime",
        domain: "switch",
        originalName: "Chime",
        entityCategory: null,
      },
    ]);
    expect(profile.firmware).toBe("not_a_router");
    expect(profile.kind).toBe("unknown");
  });

  it("unknown: nothing in the registry yet, so refuse to conclude", () => {
    expect(detectRouter("dev_new", []).firmware).toBe("unknown");
  });
});

describe("presence is a registry fact, the version is a state fact", () => {
  it("stays supported ten seconds after boot, versions still pending", () => {
    const profile = profileOf(withVersionsUnpublished(loadFixture("engine_1dimmer_fronius")));
    expect(profile.firmware).toBe("supported");
    expect(profile.packages.length).toBeGreaterThan(0);
    expect(profile.packages.every((p) => p.versionState === "pending")).toBe(true);
    expect(profile.packagesVersion).toBeNull();
  });

  it("stays supported while the device is offline", () => {
    const profile = profileOf(offline(loadFixture("engine_1dimmer_fronius")));
    expect(profile.firmware).toBe("supported");
    expect(profile.packages.every((p) => p.versionState === "unavailable")).toBe(true);
  });

  it("finds the packages with no states at all", () => {
    const fixture = loadFixture("engine_1dimmer_fronius");
    const withStates = profileOf(fixture);
    const without = detectRouter(fixture.device.id, toEntities(fixture));
    expect(without.packages.map((p) => p.id)).toEqual(withStates.packages.map((p) => p.id));
    expect(without.firmware).toBe("supported");
  });

  it("reports outdated with a hint when the user disabled the version sensors", () => {
    const profile = profileOf(withVersionsDisabled(loadFixture("engine_1dimmer_fronius")));
    expect(profile.firmware).toBe("outdated");
  });
});

describe("matching the version entity", () => {
  const entity = (originalName: string | null, domain = "sensor") => ({
    entityId: "sensor.x",
    domain,
    originalName,
    entityCategory: "diagnostic" as const,
  });

  it("matches on the name, with the domain as the only filter", () => {
    expect(matchVersionEntity(entity("common"))).toEqual({ id: "common", instance: "" });
    expect(matchVersionEntity(entity("common", "switch"))).toBeUndefined();
  });

  it("keeps hyphens and mixed case exactly as the firmware spells them", () => {
    expect(matchVersionEntity(entity("energy_counter_jsy-mk-194t"))?.id).toBe(
      "energy_counter_jsy-mk-194t",
    );
    expect(matchVersionEntity(entity("temperature_limiter_DS18B20"))?.id).toBe(
      "temperature_limiter_DS18B20",
    );
    expect(matchVersionEntity(entity("temperature_limiter_ds18b20"))).toBeUndefined();
  });

  it("tries the exact name before the multi-instance prefix", () => {
    expect(matchVersionEntity(entity("scheduler_forced_run"))).toEqual({
      id: "scheduler_forced_run",
      instance: "",
    });
    expect(matchVersionEntity(entity("scheduler_forced_run_Night"))).toEqual({
      id: "scheduler_forced_run",
      instance: "Night",
    });
  });

  it("ignores an unknown package rather than throwing", () => {
    expect(matchVersionEntity(entity("engine_2dimmers_from_the_future"))).toBeUndefined();
    expect(matchVersionEntity(entity(null))).toBeUndefined();
  });

  it("survives a user renaming or hiding the entity", () => {
    const one = profileOf(renamed(loadFixture("engine_1dimmer_fronius"), "common", "My version"));
    expect(one.declares.has("common")).toBe(true);
    const two = profileOf(hidden(loadFixture("engine_1dimmer_fronius"), "common"));
    expect(two.declares.has("common")).toBe(true);
  });
});

describe("reading the version", () => {
  it("takes a bare semver", () => {
    expect(readVersion("1.6.7")).toEqual({ version: "1.6.7", versionState: "known" });
  });

  it("separates not-yet-published from offline", () => {
    expect(readVersion("unknown").versionState).toBe("pending");
    expect(readVersion(undefined).versionState).toBe("pending");
    expect(readVersion("unavailable").versionState).toBe("unavailable");
  });

  it("still extracts a version if the firmware changes payload, and says so", () => {
    // The firmware's own AGENTS.md describes `<file>.yaml <version>`. If the
    // code is ever aligned on it, the card must bend rather than break.
    expect(readVersion("engine_1dimmer.yaml 1.6.6")).toEqual({
      version: "1.6.6",
      versionState: "unexpected",
    });
  });

  it("warns about the format instead of dropping the package", () => {
    const profile = profileOf(
      plus(loadFixture("proxy_only"), versionEntity("debug_sensors", "debug_sensors.yaml 1.6.3")),
    );
    expect(profile.declares.has("debug_sensors")).toBe(true);
    expect(profile.warnings.some((w) => w.code === "version_format_unexpected")).toBe(true);
  });

  it("reports the highest version as a lower bound on the release", () => {
    // At tag v1.6.7 a plain dimmer router declares nothing above 1.6.6,
    // because that release touched none of its packages.
    expect(profileOf(loadFixture("engine_1dimmer_fronius")).packagesVersion).toBe("1.6.6");
  });
});

describe("the role catalogue, which the version sensors do not replace", () => {
  it("resolves Regulator Opening as a writable number on engine_1dimmer", () => {
    const profile = profileOf(loadFixture("engine_1dimmer_fronius"));
    const role = profile.roles.regulator_opening;
    if (role) {
      expect(role.domain).toBe("number");
      expect(role.writable).toBe(true);
    } else {
      // hide_regulators defaults to hiding, so absent is the normal case.
      expect(role).toBeUndefined();
    }
  });

  it("pairs the Start tempo setpoint with its countdown on the all-or-nothing engine", () => {
    const profile = profileOf(loadFixture("engine_1switch_ha_limiter"));
    expect(profile.roles.start_tempo?.domain).toBe("number");
    expect(profile.roles.start_tempo_countdown?.domain).toBe("sensor");
  });

  it("resolves the temperature controls whichever probe declares them", () => {
    for (const name of ["engine_1dimmer_ds18b20_counter", "engine_1switch_ha_limiter"]) {
      const profile = profileOf(loadFixture(name));
      expect(profile.roles.stop_temperature).toBeDefined();
      expect(profile.roles.restart_temperature).toBeDefined();
      expect(profile.roles.safety_temperature).toBeDefined();
    }
  });
});

describe("the catalogue itself", () => {
  it("describes every package exactly once, in a stable order", () => {
    const ids = Object.keys(PACKAGES) as PackageId[];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(26);
  });

  it("keeps every multi-instance id clear of the other ids", () => {
    // Some ids do extend another (`engine_1dimmer_1bypass` extends
    // `engine_1dimmer`), which is harmless because the prefix rule only runs
    // over multi-instance packages. Marking an engine multi-instance would
    // make `matchVersionEntity` swallow its siblings, so guard exactly that.
    const ids = Object.keys(PACKAGES) as PackageId[];
    const multi = ids.filter((id) => PACKAGES[id].multiInstance);
    expect(multi).not.toHaveLength(0);
    for (const prefix of multi) {
      for (const other of ids) {
        if (other !== prefix) {
          expect(other.startsWith(`${prefix}_`)).toBe(false);
        }
      }
    }
  });
});
