import { describe, expect, it } from "vitest";

import {
  hardwareRows,
  highestVersion,
  packageLabel,
  warningText,
} from "../../src/components/module-summary";
import { detectRouter } from "../../src/detect/detect";
import type { DetectionWarning, RouterProfile } from "../../src/detect/types";
import { loadFixture, toEntities, toStates, type Fixture } from "../fixtures/load";

function profileOf(fixture: Fixture): RouterProfile {
  return detectRouter(fixture.device.id, toEntities(fixture), { states: toStates(fixture) });
}

describe("the hardware rows", () => {
  it("name the engine and the measurement source", () => {
    const rows = hardwareRows(profileOf(loadFixture("engine_1dimmer_fronius")));
    expect(rows).toContainEqual(["Engine", "Progressive — one dimmer"]);
    expect(rows).toContainEqual(["Power meter", "Fronius Smart Meter"]);
  });

  it("join the regulators rather than picking one", () => {
    // esp8266-proxy-client drives a solid state relay and a mechanical one.
    const rows = hardwareRows(profileOf(loadFixture("engine_1dimmer_1bypass")));
    const regulator = rows.find(([label]) => label === "Regulator")?.[1];
    expect(regulator).toContain("Solid state relay");
    expect(regulator).toContain("Mechanical relay");
    expect(regulator).toContain(" · ");
  });

  it("number the mechanical relays when there are several", () => {
    const rows = hardwareRows(profileOf(loadFixture("engine_1dimmer_2switches_1bypass")));
    const regulator = rows.find(([label]) => label === "Regulator")?.[1];
    expect(regulator).toContain("Mechanical relay 1");
    expect(regulator).toContain("Mechanical relay 3");
  });

  it("say nothing at all about a device with no hardware to report", () => {
    // A bare power meter proxy has no engine and no regulator.
    const rows = hardwareRows(profileOf(loadFixture("proxy_only")));
    expect(rows.map(([label]) => label)).toEqual(["Power meter"]);
  });
});

describe("the package label", () => {
  it("drops the instance when there is only one", () => {
    const profile = profileOf(loadFixture("engine_1dimmer_1bypass"));
    const relay = profile.packages.find((p) => p.id === "regulator_mecanical_relay");
    // `regulator_mecanical_relay_` with an empty unique id must not render as
    // "Mechanical relay " with a dangling space.
    expect(relay && packageLabel(relay)).toBe("Mechanical relay");
  });
});

describe("the highest version", () => {
  it("is a lower bound on the release, not the release", () => {
    // At tag v1.6.7 this router's packages were all untouched by that release.
    const fixture = loadFixture("engine_1dimmer_fronius");
    expect(highestVersion(profileOf(fixture), toStates(fixture))).toBe("1.6.6");
  });

  it("compares numerically, not as text", () => {
    const fixture = loadFixture("engine_1dimmer_fronius");
    const states = toStates(fixture);
    const profile = profileOf(fixture);
    for (const declared of profile.packages) {
      states[declared.entityId] = { state: "1.9.0" };
    }
    states[profile.packages[0].entityId] = { state: "1.10.0" };
    // "1.10.0" sorts before "1.9.0" as text and after it as a version.
    expect(highestVersion(profile, states)).toBe("1.10.0");
  });

  it("is null while nothing has published yet", () => {
    const fixture = loadFixture("engine_1dimmer_fronius");
    expect(highestVersion(profileOf(fixture), {})).toBeNull();
  });
});

describe("warning sentences", () => {
  const cases: DetectionWarning[] = [
    { code: "engine_leaf_missing" },
    { code: "engine_not_declared" },
    { code: "multiple_engines", engines: ["engine_1switch", "engine_1dimmer"] },
    { code: "version_format_unexpected", entityId: "sensor.x_common" },
    { code: "version_name_case_mismatch", name: "temperature_limiter_ds18b20" },
    { code: "override_unknown_role", key: "rooter_level" },
    { code: "override_off_device", role: "router_level", entityId: "number.other" },
  ];

  it.each(cases)("turns $code into a sentence naming its subject", (warning) => {
    const text = warningText(warning);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toContain("undefined");
    // Every code carrying a subject must put it in the sentence, otherwise the
    // message tells the user something is wrong but not what.
    for (const key of ["entityId", "name", "key", "role"] as const) {
      const value = (warning as Record<string, unknown>)[key];
      if (typeof value === "string") {
        expect(text).toContain(value);
      }
    }
    if (warning.code === "multiple_engines") {
      expect(text).toContain("engine_1switch");
    }
  });
});
