/**
 * The firmware packages, and how to spot the version sensor each one publishes.
 *
 * Every `solar_router/*.yaml` ends with a template `text_sensor` named after the
 * file and holding a bare semver, so a router states which packages it is built
 * from instead of leaving the card to infer it. This file is the catalogue of
 * those names; `catalog.ts` remains the catalogue of roles. Two different axes,
 * two different tables — a package says *what is loaded*, a role says *which
 * entity to call*.
 */

import type { DeviceEntity } from "./registry";
import type { DeclaredPackage, PackageDefinition, PackageId, VersionState } from "./types";

/**
 * The twenty-six packages, in display order.
 *
 * Each key is the file name without its extension, verbatim — that is exactly
 * what the firmware puts in `name:`, so the key *is* the detection key. Hyphens
 * and mixed case included: never normalise them. The ESPHome `id:` is spelled
 * differently (`version_energy_counter_jsy_mk_194t` for
 * `energy_counter_jsy-mk-194t`) because a hyphen is not valid in an id, but the
 * id never reaches Home Assistant, so it is not our business.
 *
 * Typed as `Record<PackageId, …>` so that adding a member to `PackageId`
 * without describing it here fails to compile.
 */
export const PACKAGES: Record<PackageId, PackageDefinition> = {
  // Power meters — the source of `Real Power` and `Consumption`.
  power_meter_fronius: {
    category: "power_meter",
    label: "Fronius Smart Meter",
    icon: "mdi:solar-power-variant",
  },
  power_meter_shelly_em: { category: "power_meter", label: "Shelly EM", icon: "mdi:flash" },
  power_meter_shelly_em3: {
    category: "power_meter",
    label: "Shelly EM3 / Pro 3EM",
    icon: "mdi:flash-triangle",
  },
  "power_meter_jsy-mk-194t": { category: "power_meter", label: "JSY-MK-194T", icon: "mdi:chip" },
  power_meter_home_assistant: {
    category: "power_meter",
    label: "Home Assistant",
    icon: "mdi:home-assistant",
  },
  power_meter_proxy_client: {
    category: "power_meter",
    label: "Proxy client",
    icon: "mdi:transit-connection-variant",
  },
  power_meter_common: {
    category: "power_meter",
    label: "Power meter (common)",
    icon: "mdi:package-variant",
    implicit: true,
    // `power_meter_home_assistant.yaml` merges the common with `<<:` on
    // purpose, to override `real_power` and `consumption`. The merge key keeps
    // the first definition of a key, so the leaf's `text_sensor:` replaces the
    // common's and this package never publishes a version there. Absent means
    // nothing; never warn about it.
    unreliablePresence: true,
  },
  "jsy-mk-194t_common": {
    category: "power_meter",
    label: "JSY-MK-194T (common)",
    icon: "mdi:package-variant",
    implicit: true,
  },

  // Engines — exactly one leaf per router, plus the common they all pull in.
  engine_1dimmer: {
    category: "engine",
    label: "Progressive — one dimmer",
    icon: "mdi:tune-vertical",
  },
  engine_1dimmer_1bypass: {
    category: "engine",
    label: "Progressive — one dimmer and a bypass",
    icon: "mdi:tune-vertical",
  },
  engine_1dimmer_2switches: {
    category: "engine",
    label: "Progressive — one dimmer and two relays",
    icon: "mdi:tune-vertical",
  },
  engine_1dimmer_2switches_1bypass: {
    category: "engine",
    label: "Progressive — one dimmer, two relays and a bypass",
    icon: "mdi:tune-vertical",
  },
  engine_1switch: {
    category: "engine",
    label: "All or nothing",
    icon: "mdi:toggle-switch-outline",
  },
  engine_common: {
    category: "engine",
    label: "Engine (common)",
    icon: "mdi:package-variant",
    implicit: true,
  },

  // Regulators — what actually drives the load. These publish no other entity
  // at all, so before the version sensors they were invisible to the card.
  regulator_triac: { category: "regulator", label: "Triac", icon: "mdi:sine-wave" },
  regulator_solid_state_relay: {
    category: "regulator",
    label: "Solid state relay",
    icon: "mdi:electric-switch",
  },
  regulator_mecanical_relay: {
    category: "regulator",
    label: "Mechanical relay",
    icon: "mdi:electric-switch-closed",
    multiInstance: true,
  },

  // Energy counters.
  energy_counter_theorical: {
    category: "energy_counter",
    label: "Theoretical energy counter",
    icon: "mdi:counter",
  },
  "energy_counter_jsy-mk-194t": {
    category: "energy_counter",
    label: "JSY-MK-194T energy counter",
    icon: "mdi:counter",
  },

  // Temperature.
  temperature_limiter_DS18B20: {
    category: "temperature",
    label: "DS18B20 probe",
    icon: "mdi:thermometer",
  },
  temperature_limiter_home_assistant: {
    category: "temperature",
    label: "Home Assistant temperature",
    icon: "mdi:thermometer",
  },
  temperature_limiter_common: {
    category: "temperature",
    label: "Temperature limiter (common)",
    icon: "mdi:package-variant",
    implicit: true,
  },
  temperature_fan_control: { category: "temperature", label: "Fan control", icon: "mdi:fan" },

  // Scheduler — one instance per `scheduler_unique_id`, `Forced` by default.
  scheduler_forced_run: {
    category: "scheduler",
    label: "Scheduler",
    icon: "mdi:clock-outline",
    multiInstance: true,
  },

  // System.
  common: { category: "system", label: "Core", icon: "mdi:cog-outline" },
  debug_sensors: { category: "system", label: "Debug sensors", icon: "mdi:bug-outline" },
};

/**
 * Display order of the packages.
 *
 * Derived from the declaration order above rather than maintained by hand:
 * JavaScript preserves the insertion order of string keys, and one list that
 * cannot drift from the other is worth more than the freedom to order them
 * differently.
 */
export const PACKAGE_ORDER: readonly PackageId[] = Object.freeze(
  Object.keys(PACKAGES) as PackageId[],
);

const MULTI_INSTANCE: readonly PackageId[] = PACKAGE_ORDER.filter(
  (id) => PACKAGES[id].multiInstance,
);

const BARE_SEMVER = /^\d+\.\d+\.\d+$/;
const EMBEDDED_SEMVER = /\d+\.\d+\.\d+/;

/**
 * Match one entity against the package catalogue.
 *
 * The name is the key; the domain is the only filter. `entity_category` and the
 * shape of the state are validators worth warning about, never gates — gating
 * on the state is how you report a freshly booted router as an outdated one.
 *
 * Exact match first, prefix rule second, and the order matters: several ids
 * *are* another id followed by `_` (`engine_1dimmer_1bypass` extends
 * `engine_1dimmer`). What keeps the prefix rule safe is that it only ever runs
 * over the multi-instance packages, and neither of those two — mechanical
 * relay, scheduler — is a prefix of anything else. Marking an engine
 * multi-instance would break that, which is why a test guards it.
 */
export function matchVersionEntity(
  entity: DeviceEntity,
): { readonly id: PackageId; readonly instance: string } | undefined {
  if (entity.domain !== "sensor") {
    return undefined;
  }
  const name = entity.originalName?.trim();
  if (!name) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(PACKAGES, name)) {
    return { id: name as PackageId, instance: "" };
  }

  for (const id of MULTI_INSTANCE) {
    if (name.startsWith(`${id}_`)) {
      // `regulator_mecanical_relay_` with the default empty `relay_unique_id`
      // leaves an empty instance, which is exactly right: the separator eats
      // the trailing underscore.
      return { id, instance: name.slice(id.length + 1) };
    }
  }

  return undefined;
}

/** Read a version out of an entity state, tolerantly. See `VersionState`. */
export function readVersion(state: string | undefined): {
  readonly version: string | null;
  readonly versionState: VersionState;
} {
  if (state === undefined || state === "unknown" || state === "") {
    return { version: null, versionState: "pending" };
  }
  if (state === "unavailable") {
    return { version: null, versionState: "unavailable" };
  }
  if (BARE_SEMVER.test(state)) {
    return { version: state, versionState: "known" };
  }
  // The firmware's own AGENTS.md describes a different payload —
  // `<file>.yaml <version>`. If the code is ever aligned on it, extract the
  // version rather than break, and let the editor surface the mismatch.
  const embedded = EMBEDDED_SEMVER.exec(state);
  if (embedded) {
    return { version: embedded[0], versionState: "unexpected" };
  }
  return { version: null, versionState: "unexpected" };
}

/**
 * The packages a device declares.
 *
 * Presence comes from `entities` (the registry) and never from `states`, which
 * is what makes the ten-second window between boot and the first publication
 * harmless: without `states` every version is simply `pending`, and the list of
 * packages is already complete and correct.
 */
export function collectDeclaredPackages(
  entities: readonly DeviceEntity[],
  states?: Readonly<Record<string, { readonly state: string }>>,
): DeclaredPackage[] {
  const found: DeclaredPackage[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const match = matchVersionEntity(entity);
    if (!match) {
      continue;
    }
    const key = `${match.id} ${match.instance}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const { version, versionState } = readVersion(states?.[entity.entityId]?.state);
    found.push({
      id: match.id,
      instance: match.instance,
      declaredName: entity.originalName ?? "",
      entityId: entity.entityId,
      version,
      versionState,
    });
  }

  found.sort(
    (a, b) =>
      PACKAGE_ORDER.indexOf(a.id) - PACKAGE_ORDER.indexOf(b.id) ||
      a.instance.localeCompare(b.instance),
  );
  return found;
}

/** Compare two semvers. `null` when either is unreadable. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = BARE_SEMVER.test(a) ? a.split(".").map(Number) : null;
  const pb = BARE_SEMVER.test(b) ? b.split(".").map(Number) : null;
  if (!pa || !pb) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}
