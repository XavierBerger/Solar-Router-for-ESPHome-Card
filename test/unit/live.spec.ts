import { describe, expect, it } from "vitest";

import { ARC_LENGTH, dashOffset } from "../../src/components/gauge";
import { openWindow, powerDirection } from "../../src/sections/live";
import type { ResolvedRole, SchedulerInstance, SchedulerRole } from "../../src/detect/types";
import type { HomeAssistant } from "../../src/types/home-assistant";

function role(entityId: string): ResolvedRole {
  return { entityId, domain: "number", writable: true, source: "original_name" };
}

/** A scheduler whose four edges and switch are all resolved. */
function scheduler(id: string): SchedulerInstance {
  const roles: Partial<Record<SchedulerRole, ResolvedRole>> = {
    activate: role(`switch.${id}_activate`),
    begin_hour: role(`number.${id}_begin_hour`),
    begin_minute: role(`number.${id}_begin_minute`),
    end_hour: role(`number.${id}_end_hour`),
    end_minute: role(`number.${id}_end_minute`),
  };
  return { id, roles };
}

function hassWith(id: string, values: Record<string, string>): HomeAssistant {
  const states: Record<string, { state: string }> = {
    [`switch.${id}_activate`]: { state: values.enabled ?? "on" },
    [`number.${id}_begin_hour`]: { state: values.beginHour ?? "0" },
    [`number.${id}_begin_minute`]: { state: values.beginMinute ?? "0" },
    [`number.${id}_end_hour`]: { state: values.endHour ?? "0" },
    [`number.${id}_end_minute`]: { state: values.endMinute ?? "0" },
  };
  return { states, language: "en" } as unknown as HomeAssistant;
}

function at(hours: number, minutes: number): Date {
  return new Date(2026, 0, 15, hours, minutes);
}

describe("the power direction", () => {
  it("reads a negative reading as export, which is what the firmware means", () => {
    // `solar_router/engine_1switch.yaml` says it outright: "Energy export is
    // negative". Getting this backwards would invert the whole live band.
    expect(powerDirection(-1240)).toBe("export");
    expect(powerDirection(1700)).toBe("import");
  });

  it("calls a reading near zero balanced rather than flickering", () => {
    expect(powerDirection(0)).toBe("balanced");
    expect(powerDirection(0.4)).toBe("balanced");
    expect(powerDirection(-0.4)).toBe("balanced");
  });
});

describe("the gauge arithmetic", () => {
  it("draws nothing at zero and the whole arc at full", () => {
    expect(dashOffset(0)).toBeCloseTo(ARC_LENGTH, 5);
    expect(dashOffset(100)).toBeCloseTo(0, 5);
  });

  it("draws half the arc at half", () => {
    expect(dashOffset(50)).toBeCloseTo(ARC_LENGTH / 2, 5);
  });

  it("clamps rather than overshooting, since the firmware can report either", () => {
    expect(dashOffset(-20)).toBeCloseTo(ARC_LENGTH, 5);
    expect(dashOffset(140)).toBeCloseTo(0, 5);
  });

  it("sweeps three quarters of a circle", () => {
    expect(ARC_LENGTH).toBeCloseTo(2 * Math.PI * 40 * 0.75, 5);
  });
});

describe("the scheduler window", () => {
  const day = scheduler("day");

  it("is open inside a daytime slot", () => {
    const hass = hassWith("day", { beginHour: "9", endHour: "17" });
    expect(openWindow(hass, day, at(12, 0))?.until).toBe("17:00");
  });

  it("is closed outside it", () => {
    const hass = hassWith("day", { beginHour: "9", endHour: "17" });
    expect(openWindow(hass, day, at(8, 59))).toBeNull();
    expect(openWindow(hass, day, at(17, 0))).toBeNull();
  });

  it("wraps around midnight, which a night slot needs", () => {
    // 22:00 → 06:00. Comparing begin < end naively would call this never open.
    const hass = hassWith("day", { beginHour: "22", endHour: "6" });
    expect(openWindow(hass, day, at(23, 30))).not.toBeNull();
    expect(openWindow(hass, day, at(2, 0))).not.toBeNull();
    expect(openWindow(hass, day, at(12, 0))).toBeNull();
  });

  it("stays shut when the scheduler is disabled, whatever the clock says", () => {
    const hass = hassWith("day", { enabled: "off", beginHour: "9", endHour: "17" });
    expect(openWindow(hass, day, at(12, 0))).toBeNull();
  });

  it("says nothing when an edge is unavailable rather than guessing", () => {
    const hass = hassWith("day", { beginHour: "unavailable", endHour: "17" });
    expect(openWindow(hass, day, at(12, 0))).toBeNull();
  });

  it("pads the end time to HH:MM", () => {
    const hass = hassWith("day", { beginHour: "1", endHour: "2", endMinute: "5" });
    expect(openWindow(hass, day, at(1, 30))?.until).toBe("02:05");
  });

  it("honours the minutes, not just the hours", () => {
    const hass = hassWith("day", {
      beginHour: "9",
      beginMinute: "30",
      endHour: "10",
      endMinute: "0",
    });
    expect(openWindow(hass, day, at(9, 29))).toBeNull();
    expect(openWindow(hass, day, at(9, 31))).not.toBeNull();
  });
});
