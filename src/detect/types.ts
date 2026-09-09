/**
 * The vocabulary of detection.
 *
 * A *role* is what the card needs ("the router level"), an *entity* is what a
 * given device happens to expose. Detection maps the second onto the first, so
 * every section of the card can ask for a role and get either an entity id or
 * nothing at all — never a broken reference.
 */

/**
 * Home Assistant domains the firmware publishes into.
 *
 * Deliberately not the full HA list: only what `solar_router/*.yaml` creates.
 * Note that an ESPHome `text_sensor` lands in the `sensor` domain, which is why
 * there is no `text_sensor` here.
 */
export type Domain = "binary_sensor" | "light" | "number" | "sensor" | "switch";

/** Domains whose entities the user can write to. */
const WRITABLE_DOMAINS: ReadonlySet<string> = new Set<Domain>(["light", "number", "switch"]);

export function isWritableDomain(domain: string): boolean {
  return WRITABLE_DOMAINS.has(domain);
}

/** The five engines of the firmware, one per `engine_*.yaml` package. */
export type EngineId =
  | "engine_1dimmer"
  | "engine_1dimmer_1bypass"
  | "engine_1dimmer_2switches"
  | "engine_1dimmer_2switches_1bypass"
  | "engine_1switch";

/**
 * A firmware package, named exactly as its `solar_router/*.yaml` file.
 *
 * Each literal is what that package's version `text_sensor` publishes in
 * `name:`, so this union *is* the detection key. Hyphens and mixed case are
 * part of it (`energy_counter_jsy-mk-194t`, `temperature_limiter_DS18B20`) —
 * never normalise them.
 */
export type PackageId =
  | EngineId
  | "common"
  | "debug_sensors"
  | "energy_counter_jsy-mk-194t"
  | "energy_counter_theorical"
  | "engine_common"
  | "jsy-mk-194t_common"
  | "power_meter_common"
  | "power_meter_fronius"
  | "power_meter_home_assistant"
  | "power_meter_jsy-mk-194t"
  | "power_meter_proxy_client"
  | "power_meter_shelly_em"
  | "power_meter_shelly_em3"
  | "regulator_mecanical_relay"
  | "regulator_solid_state_relay"
  | "regulator_triac"
  | "scheduler_forced_run"
  | "temperature_fan_control"
  | "temperature_limiter_DS18B20"
  | "temperature_limiter_common"
  | "temperature_limiter_home_assistant";

/** How the summary groups packages, and the order it shows them in. */
export type PackageCategory =
  | "power_meter"
  | "engine"
  | "regulator"
  | "energy_counter"
  | "temperature"
  | "scheduler"
  | "system";

/** What the catalogue knows about one package. See `packages.ts`. */
export interface PackageDefinition {
  readonly category: PackageCategory;
  /** English fallback; phase 3 translates under the key `package.<id>`. */
  readonly label: string;
  /** Icon for the summary. */
  readonly icon: string;
  /**
   * Pulled in by another package rather than chosen by the user
   * (`engine_common`, `power_meter_common`, `temperature_limiter_common`).
   * Folded away behind "internal packages" in the summary.
   */
  readonly implicit?: boolean;
  /**
   * Can be loaded more than once, its `name:` carrying a `_${unique_id}`
   * suffix. That suffix may be empty: `relay_unique_id` defaults to `""`, so
   * one mechanical relay publishes `regulator_mecanical_relay_`.
   */
  readonly multiInstance?: boolean;
  /**
   * Its version sensor can be missing while the package *is* loaded, so its
   * absence proves nothing and must never be reported. See the comment on
   * `power_meter_common` in `packages.ts`.
   */
  readonly unreliablePresence?: boolean;
}

/** How much is known about a package's version. Never a reason to reject it. */
export type VersionState =
  /** A bare semver was read. */
  | "known"
  /** `unknown`: the sensor publishes once, about ten seconds after boot. */
  | "pending"
  /** `unavailable`: the device is offline. */
  | "unavailable"
  /** The state exists but is not a bare semver — the firmware changed format. */
  | "unexpected";

/** One package a device declares, and the version it declares for it. */
export interface DeclaredPackage {
  readonly id: PackageId;
  /** `""` unless multi-instance with a non-empty id: `"1"`, `"2"`, `"Forced"`. */
  readonly instance: string;
  /** `original_name` verbatim, e.g. `regulator_mecanical_relay_2`. */
  readonly declaredName: string;
  readonly entityId: string;
  readonly version: string | null;
  readonly versionState: VersionState;
}

/**
 * Whether the card can work with this device.
 *
 * Four values rather than two: a device that has never connected is not an
 * outdated router, and refusing to conclude is the right answer.
 */
export type FirmwareSupport =
  /** At least one package declares itself. */
  | "supported"
  /** No package, but the roles say this is a router — old firmware. */
  | "outdated"
  /** No package and no role: some other ESPHome device. */
  | "not_a_router"
  /** No entity at all in the registry yet. */
  | "unknown";

/**
 * Which family of packages publishes a role.
 *
 * Coarser than `PackageId` on purpose: `Activate Solar Routing` is declared by
 * all five engines and `Power divertion` by both energy counters, so naming one
 * of them would be false precision. Informational only — which packages a
 * device runs is declared, not deduced from roles.
 */
export type RoleOwner =
  | "engine"
  | "power_meter"
  | "power_meter_shelly_em3"
  | "jsy-mk-194t_common"
  | "energy_counter"
  | "temperature_limiter"
  | "temperature_fan_control"
  | "scheduler_forced_run"
  | "common"
  | "debug_sensors";

/** Where a role renders. One section id per module of `src/sections/`. */
export type SectionId =
  | "header"
  | "live"
  | "routing"
  | "onoff"
  | "bypass"
  | "energy"
  | "temperature"
  | "fan"
  | "scheduler"
  | "advanced"
  | "diagnostics";

/**
 * Unit label the card puts on a value.
 *
 * The firmware is inconsistent — `"w"` on `stop_power_level`, `""` on the
 * reactivities, `device_class: duration` with no unit on `Relay N Countdown` —
 * so the card labels by role instead of echoing `unit_of_measurement`. That
 * also makes the labels translatable.
 */
export type Unit = "%" | "A" | "B" | "h" | "Hz" | "kWh" | "min" | "ms" | "s" | "V" | "W" | "°C";

/** Every role the card knows how to use, whatever the device turns out to have. */
export type Role =
  // Header
  | "activate"
  // Power meter
  | "real_power"
  | "consumption"
  // Progressive engines
  | "router_level"
  | "target_grid_exchange"
  | "up_reactivity"
  | "down_reactivity"
  | "regulator_opening"
  // All-or-nothing engine
  | "start_power_level"
  | "stop_power_level"
  | "start_tempo"
  | "start_tempo_countdown"
  | "stop_tempo"
  | "stop_tempo_countdown"
  // Bypass and relays
  | "bypass_relay"
  | "bypass_tempo"
  | "bypass_tempo_countdown"
  | "energy_divertion"
  | "energy_divertion_relay_1"
  | "energy_divertion_relay_2"
  | "energy_divertion_relay_3_bypass"
  | "relay_1_countdown"
  | "relay_2_countdown"
  | "relay_3_countdown"
  // LEDs
  | "green_led"
  | "yellow_led"
  // Energy counters
  | "load_power"
  | "power_divertion"
  | "total_energy_diverted"
  | "total_daily_energy_diverted"
  // Temperature limiter
  | "safety_temperature"
  | "safety_limit_reached"
  | "stop_temperature"
  | "restart_temperature"
  | "used_for_cooling"
  // Fan control
  | "fan_start_temperature"
  | "fan_stop_temperature"
  // common.yaml
  | "restart"
  | "uptime"
  // debug_sensors.yaml
  | "device_info"
  | "reset_reason"
  | "heap_free"
  | "heap_max_block"
  | "loop_time"
  | "free_psram"
  | "cpu_frequency"
  // Shelly EM3 per-phase readings
  | "em3_phase_a_power"
  | "em3_phase_b_power"
  | "em3_phase_c_power"
  // JSY-MK-194T channels
  | "jsy_voltage_ch1"
  | "jsy_current_ch1"
  | "jsy_active_power_ch1"
  | "jsy_positive_energy_ch1"
  | "jsy_negative_energy_ch1"
  | "jsy_power_factor_ch1"
  | "jsy_power_direction_ch1"
  | "jsy_current_ch2"
  | "jsy_active_power_ch2"
  | "jsy_positive_energy_ch2"
  | "jsy_negative_energy_ch2"
  | "jsy_power_factor_ch2"
  | "jsy_power_direction_ch2"
  | "jsy_frequency";

/**
 * A role of one scheduler instance.
 *
 * Schedulers are multi-instance by design (`scheduler_unique_id`), so their
 * roles are resolved per instance rather than once for the device.
 */
export type SchedulerRole =
  | "activate"
  | "router_level"
  | "checking_end_threshold"
  | "begin_hour"
  | "begin_minute"
  | "end_hour"
  | "end_minute";

/** What the catalog knows about one role. See `catalog.ts`. */
export interface RoleDefinition {
  /**
   * Candidate domains, in preference order — the first that matches wins.
   *
   * Usually one. `Regulator Opening` has two: it is a `number` in
   * `engine_1dimmer` and a `sensor` in the three other dimmer engines, and the
   * difference is a feature (the dimmer engine really lets you drive the
   * regulator by hand), so the matched domain decides whether the card renders
   * a slider or a readout.
   */
  readonly domains: readonly Domain[];
  /** The ESPHome `name:`, verbatim — half of the detection key. */
  readonly name: string;
  /** The family of packages that publishes this entity. */
  readonly owner: RoleOwner;
  /** Where the card renders it. */
  readonly section: SectionId;
  /** Unit the card labels the value with, whatever the firmware declares. */
  readonly unit?: Unit;
  /**
   * The entity does not exist with the package's default substitutions — the
   * firmware wires its `internal:` to `hide_regulators`, `hide_leds` or one of
   * the JSY `*_internal`, all of which default to hiding. Its absence
   * therefore says nothing: the card must not present it as missing, and must
   * not alert on it.
   *
   * Two nearby traps that this flag does *not* cover, because the defaults go
   * the other way: `Consumption` is visible in `power_meter_common` but hidden
   * by `power_meter_shelly_em3`, and `show_phase_power: "False"` feeds
   * `internal:` directly, so the default value makes the EM3 phase sensors
   * *visible*.
   */
  readonly hiddenByDefault?: boolean;
  /** Setpoint ↔ countdown twin, so the UI can show the pair together. */
  readonly pairedWith?: Role;
  /**
   * Compiles to `ALWAYS_OFF`: the switch falls back to OFF after a restart.
   * The card says so rather than letting the user discover it.
   */
  readonly resetsOnRestart?: boolean;
}

/** A scheduler role, whose entity name is built from the instance id. */
export interface SchedulerRoleDefinition {
  readonly domains: readonly Domain[];
  /** Entity name with `{id}` standing for `scheduler_unique_id`. */
  readonly nameTemplate: string;
  readonly unit?: Unit;
}

/** How a role's entity was found. */
export type RoleSource =
  /** Matched `(domain, original_name)` — the contract. */
  | "original_name"
  /** Matched the slugified entity id, `original_name` being empty. */
  | "entity_id"
  /** Pinned by the user in the card configuration. */
  | "override";

export interface ResolvedRole {
  readonly entityId: string;
  /** The domain that actually matched, which may not be the preferred one. */
  readonly domain: string;
  /** True when the user can write to it — a slider rather than a readout. */
  readonly writable: boolean;
  readonly source: RoleSource;
}

export interface SchedulerInstance {
  /** `scheduler_unique_id` verbatim: `Forced` by default, or `day` / `night`. */
  readonly id: string;
  readonly roles: Partial<Record<SchedulerRole, ResolvedRole>>;
}

/**
 * What the device is, before asking which engine it runs.
 *
 * A power meter proxy publishes `Real Power` and no engine at all, and deserves
 * a reduced card rather than an error.
 */
export type DeviceKind = "router" | "power_meter" | "unknown";

/**
 * Something the editor should tell the user about, none of which is an error.
 *
 * Stable codes rather than sentences, so phase 3 can translate them without
 * parsing English back.
 */
export type DetectionWarning =
  /** Packages are declared, `engine_common` among them, but no engine leaf is. */
  | { readonly code: "engine_leaf_missing" }
  /** The roles say this is a router, yet no engine package declares itself. */
  | { readonly code: "engine_not_declared" }
  /** Two engine leaves at once — impossible on a sound build, so worth saying. */
  | { readonly code: "multiple_engines"; readonly engines: readonly EngineId[] }
  /** A version sensor whose state is not a bare semver. See `VersionState`. */
  | { readonly code: "version_format_unexpected"; readonly entityId: string }
  /** A package name that differs from a catalogue entry only by case. */
  | { readonly code: "version_name_case_mismatch"; readonly name: string }
  /** `entities:` names a role the catalog does not have — a typo, most likely. */
  | { readonly code: "override_unknown_role"; readonly key: string }
  /** An override points at an entity that is not on this device. Allowed, but worth saying. */
  | { readonly code: "override_off_device"; readonly role: string; readonly entityId: string };

export interface RouterProfile {
  readonly deviceId: string;
  /** Whether the card can work with this device at all. Check it first. */
  readonly firmware: FirmwareSupport;
  readonly kind: DeviceKind;
  /** Null on a proxy, and on a device declaring no engine leaf. */
  readonly engine: EngineId | null;
  /** Every package the device declares, in display order. */
  readonly packages: readonly DeclaredPackage[];
  /** The same set, for an O(1) membership test from the sections. */
  readonly declares: ReadonlySet<PackageId>;
  /** The regulators driving the load — a list, never a single value. */
  readonly regulators: readonly DeclaredPackage[];
  readonly roles: Partial<Record<Role, ResolvedRole>>;
  readonly schedulers: readonly SchedulerInstance[];
  /**
   * How many `regulator_mecanical_relay` instances are declared.
   *
   * Not the same thing as `relayCountdowns`: `esp8266-proxy-client.yaml` loads
   * a mechanical relay while its `engine_1dimmer_1bypass` publishes no
   * countdown at all.
   */
  readonly mechanicalRelays: number;
  /** Number of `Relay N Countdown` sensors the engine publishes. */
  readonly relayCountdowns: number;
  /**
   * Highest version among the declared packages.
   *
   * A *lower bound* on the installed release, never the release itself: a
   * release only bumps the packages it touched, so at tag v1.6.7 a plain
   * dimmer router declares nothing above 1.6.6. Label it `≥`.
   */
  readonly packagesVersion: string | null;
  /** Entities no role and no package claimed, for generic rendering. */
  readonly unclaimed: readonly string[];
  /** Facts worth telling the user in the editor, not exceptions. */
  readonly warnings: readonly DetectionWarning[];
}
