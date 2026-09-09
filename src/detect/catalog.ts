/**
 * The catalog: every entity the firmware publishes, keyed by role.
 *
 * Each `name` below is the ESPHome `name:` copied verbatim from
 * `solar_router/*.yaml` in the firmware repository, which declares those names
 * to be public API. Two consequences:
 *
 * - **Never "fix" a name here.** `Energy divertion Realy 3 Bypass` carries a
 *   typo and `safety_temperature` is the one name that is not capitalised;
 *   correcting either would stop matching every installation in the field.
 * - When the firmware adds a package, this file is what needs extending — the
 *   detection algorithm in `detect.ts` stays as it is.
 */

import type {
  Domain,
  EngineId,
  ModuleId,
  Role,
  RoleDefinition,
  SchedulerRole,
  SchedulerRoleDefinition,
} from "./types";

/**
 * `Record<Role, …>` on purpose: adding a role to the union without describing
 * it here is a compile error, so the two never drift apart.
 */
export const CATALOG: Record<Role, RoleDefinition> = {
  // --- Header ------------------------------------------------------------
  activate: {
    domains: ["switch"],
    name: "Activate Solar Routing",
    // Published by every engine, which is exactly what makes it the signal
    // that a device is a router at all rather than a power meter proxy.
    owner: "engine",
    section: "header",
  },

  // --- Power meter (power_meter_common.yaml, shared by all five meters) ---
  real_power: {
    domains: ["sensor"],
    name: "Real Power",
    owner: "power_meter",
    section: "live",
    unit: "W",
  },
  consumption: {
    // Visible from `power_meter_common`, but `power_meter_shelly_em3` sets
    // `consumption_sensor_internal: "true"` and the JSY root configs do the
    // same, so a router without it is normal. Not a detection signal — which
    // is why it carries no `hiddenByDefault`: the default really is visible.
    domains: ["sensor"],
    name: "Consumption",
    owner: "power_meter",
    section: "live",
    unit: "W",
  },

  // --- Progressive engines ------------------------------------------------
  router_level: {
    domains: ["number"],
    name: "Router Level",
    owner: "engine",
    section: "routing",
    unit: "%",
  },
  target_grid_exchange: {
    domains: ["number"],
    name: "Target grid exchange",
    owner: "engine",
    section: "routing",
    unit: "W",
  },
  up_reactivity: {
    domains: ["number"],
    name: "Up Reactivity",
    owner: "engine",
    section: "advanced",
    // `unit_of_measurement: ""` in the firmware: a ponderation, not a quantity.
  },
  down_reactivity: {
    domains: ["number"],
    name: "Down Reactivity",
    owner: "engine",
    section: "advanced",
  },
  regulator_opening: {
    // `number` in engine_1dimmer, `sensor` in the three other dimmer engines.
    // Preferring `number` makes the card offer the manual control when the
    // engine supports it, and fall back to a readout when it does not.
    domains: ["number", "sensor"],
    name: "Regulator Opening",
    owner: "engine",
    section: "advanced",
    unit: "%",
    hiddenByDefault: true,
  },

  // --- All-or-nothing engine ---------------------------------------------
  start_power_level: {
    domains: ["number"],
    name: "Start power level",
    owner: "engine",
    section: "onoff",
    unit: "W",
  },
  stop_power_level: {
    domains: ["number"],
    name: "Stop power level",
    owner: "engine",
    section: "onoff",
    unit: "W",
  },
  start_tempo: {
    domains: ["number"],
    name: "Start tempo",
    owner: "engine",
    section: "onoff",
    unit: "s",
    pairedWith: "start_tempo_countdown",
  },
  start_tempo_countdown: {
    // Same name as the setpoint, different domain: the sensor counts down to
    // the setpoint's value. The domain is what tells them apart.
    domains: ["sensor"],
    name: "Start tempo",
    owner: "engine",
    section: "live",
    unit: "s",
    pairedWith: "start_tempo",
  },
  stop_tempo: {
    domains: ["number"],
    name: "Stop tempo",
    owner: "engine",
    section: "onoff",
    unit: "s",
    pairedWith: "stop_tempo_countdown",
  },
  stop_tempo_countdown: {
    domains: ["sensor"],
    name: "Stop tempo",
    owner: "engine",
    section: "live",
    unit: "s",
    pairedWith: "stop_tempo",
  },

  // --- Bypass and switched relays ----------------------------------------
  bypass_relay: {
    domains: ["binary_sensor"],
    name: "Bypass Relay",
    owner: "engine",
    section: "bypass",
  },
  bypass_tempo: {
    // Firmware id `full_power_duration`: how long the regulator must stay at
    // 100 % before the bypass relay closes. No `unit_of_measurement` in the
    // firmware, but the value is a number of regulation cycles, i.e. seconds.
    domains: ["number"],
    name: "Bypass tempo",
    owner: "engine",
    section: "bypass",
    unit: "s",
    pairedWith: "bypass_tempo_countdown",
  },
  bypass_tempo_countdown: {
    // Firmware id `bypass_tempo_counter`.
    domains: ["sensor"],
    name: "Bypass tempo",
    owner: "engine",
    section: "bypass",
    unit: "s",
    hiddenByDefault: true,
    pairedWith: "bypass_tempo",
  },
  energy_divertion: {
    domains: ["switch"],
    name: "Energy divertion",
    owner: "engine",
    section: "advanced",
    hiddenByDefault: true,
  },
  energy_divertion_relay_1: {
    domains: ["switch"],
    name: "Energy divertion Relay 1",
    owner: "engine",
    section: "advanced",
    hiddenByDefault: true,
  },
  energy_divertion_relay_2: {
    domains: ["switch"],
    name: "Energy divertion Relay 2",
    owner: "engine",
    section: "advanced",
    hiddenByDefault: true,
  },
  energy_divertion_relay_3_bypass: {
    // The typo is in the firmware and is part of the public API. Do not fix it.
    domains: ["switch"],
    name: "Energy divertion Realy 3 Bypass",
    owner: "engine",
    section: "advanced",
    hiddenByDefault: true,
  },
  relay_1_countdown: {
    domains: ["sensor"],
    name: "Relay 1 Countdown",
    owner: "engine",
    section: "advanced",
    // `device_class: duration` with no unit in the firmware.
    unit: "s",
  },
  relay_2_countdown: {
    domains: ["sensor"],
    name: "Relay 2 Countdown",
    owner: "engine",
    section: "advanced",
    unit: "s",
  },
  relay_3_countdown: {
    domains: ["sensor"],
    name: "Relay 3 Countdown",
    owner: "engine",
    section: "advanced",
    unit: "s",
  },

  // --- LEDs (engine_common.yaml) ------------------------------------------
  green_led: {
    domains: ["light"],
    name: "Green Led",
    owner: "engine",
    section: "advanced",
    hiddenByDefault: true,
  },
  yellow_led: {
    domains: ["light"],
    name: "Yellow Led",
    owner: "engine",
    section: "advanced",
    hiddenByDefault: true,
  },

  // --- Energy counters ----------------------------------------------------
  load_power: {
    domains: ["number"],
    name: "Load power",
    owner: "energy_counter",
    section: "energy",
    unit: "W",
  },
  power_divertion: {
    // Published by both energy counters under the same name.
    domains: ["sensor"],
    name: "Power divertion",
    owner: "energy_counter",
    section: "live",
    unit: "W",
  },
  total_energy_diverted: {
    domains: ["sensor"],
    name: "Total energy diverted",
    owner: "energy_counter",
    section: "live",
    unit: "kWh",
  },
  total_daily_energy_diverted: {
    domains: ["sensor"],
    name: "Total daily energy diverted",
    owner: "energy_counter",
    section: "live",
    unit: "kWh",
  },

  // --- Temperature limiter ------------------------------------------------
  safety_temperature: {
    // The one name the firmware does not capitalise. Identical in the DS18B20
    // and Home Assistant variants, which is why the card does not try to tell
    // them apart.
    domains: ["sensor"],
    name: "safety_temperature",
    owner: "temperature_limiter",
    section: "live",
    unit: "°C",
  },
  safety_limit_reached: {
    domains: ["binary_sensor"],
    name: "Safety limit reached",
    owner: "temperature_limiter",
    section: "live",
  },
  stop_temperature: {
    domains: ["number"],
    name: "Stop temperature",
    owner: "temperature_limiter",
    section: "temperature",
    unit: "°C",
  },
  restart_temperature: {
    domains: ["number"],
    name: "Restart temperature",
    owner: "temperature_limiter",
    section: "temperature",
    unit: "°C",
  },
  used_for_cooling: {
    domains: ["switch"],
    name: "Used for cooling",
    owner: "temperature_limiter",
    section: "temperature",
    resetsOnRestart: true,
  },

  // --- Fan control --------------------------------------------------------
  fan_start_temperature: {
    domains: ["number"],
    name: "Temperature to start fan",
    owner: "temperature_fan_control",
    section: "fan",
    unit: "°C",
  },
  fan_stop_temperature: {
    domains: ["number"],
    name: "Temperature to stop fan",
    owner: "temperature_fan_control",
    section: "fan",
    unit: "°C",
  },

  // --- common.yaml --------------------------------------------------------
  restart: {
    // `platform: restart` under `switch:`, so a switch in Home Assistant.
    domains: ["switch"],
    name: "Restart",
    owner: "common",
    section: "advanced",
  },
  uptime: {
    domains: ["sensor"],
    name: "Uptime Sensor",
    owner: "common",
    section: "diagnostics",
    unit: "s",
  },

  // --- debug_sensors.yaml -------------------------------------------------
  device_info: {
    // An ESPHome text_sensor, which Home Assistant puts in the sensor domain.
    domains: ["sensor"],
    name: "Device Info",
    owner: "debug_sensors",
    section: "diagnostics",
  },
  reset_reason: {
    domains: ["sensor"],
    name: "Reset Reason",
    owner: "debug_sensors",
    section: "diagnostics",
  },
  heap_free: {
    domains: ["sensor"],
    name: "Heap Free",
    owner: "debug_sensors",
    section: "diagnostics",
    unit: "B",
  },
  heap_max_block: {
    domains: ["sensor"],
    name: "Heap Max Block",
    owner: "debug_sensors",
    section: "diagnostics",
    unit: "B",
  },
  loop_time: {
    domains: ["sensor"],
    name: "Loop Time",
    owner: "debug_sensors",
    section: "diagnostics",
    unit: "ms",
  },
  free_psram: {
    domains: ["sensor"],
    name: "Free PSRAM",
    owner: "debug_sensors",
    section: "diagnostics",
    unit: "B",
  },
  cpu_frequency: {
    domains: ["sensor"],
    name: "CPU Frequency",
    owner: "debug_sensors",
    section: "diagnostics",
    unit: "Hz",
  },

  // --- Shelly EM3 per-phase readings --------------------------------------
  // `show_phase_power` feeds `internal:` directly, so its default of "False"
  // leaves these three *visible*. Expect them, and keep them in diagnostics.
  em3_phase_a_power: {
    domains: ["sensor"],
    name: "EM3 Phase A Active Power",
    owner: "power_meter_shelly_em3",
    section: "diagnostics",
    unit: "W",
  },
  em3_phase_b_power: {
    domains: ["sensor"],
    name: "EM3 Phase B Active Power",
    owner: "power_meter_shelly_em3",
    section: "diagnostics",
    unit: "W",
  },
  em3_phase_c_power: {
    domains: ["sensor"],
    name: "EM3 Phase C Active Power",
    owner: "power_meter_shelly_em3",
    section: "diagnostics",
    unit: "W",
  },

  // --- JSY-MK-194T channels ----------------------------------------------
  // Every one of these defaults to `internal: "true"`, so a JSY router shows
  // only the channels its owner deliberately un-hid.
  jsy_voltage_ch1: {
    domains: ["sensor"],
    name: "Voltage Ch1",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "V",
    hiddenByDefault: true,
  },
  jsy_current_ch1: {
    domains: ["sensor"],
    name: "Current Ch1",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "A",
    hiddenByDefault: true,
  },
  jsy_active_power_ch1: {
    domains: ["sensor"],
    name: "Active Power Ch1",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "W",
    hiddenByDefault: true,
  },
  jsy_positive_energy_ch1: {
    domains: ["sensor"],
    name: "Positive Active Energy Ch1",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "kWh",
    hiddenByDefault: true,
  },
  jsy_negative_energy_ch1: {
    domains: ["sensor"],
    name: "Negative Active Energy Ch1",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "kWh",
    hiddenByDefault: true,
  },
  jsy_power_factor_ch1: {
    domains: ["sensor"],
    name: "Power Factor Ch1",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "%",
    hiddenByDefault: true,
  },
  jsy_power_direction_ch1: {
    domains: ["sensor"],
    name: "Power Direction Ch1",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    hiddenByDefault: true,
  },
  jsy_current_ch2: {
    domains: ["sensor"],
    name: "Current Ch2",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "A",
    hiddenByDefault: true,
  },
  jsy_active_power_ch2: {
    // The channel that measures what the router diverts, hence the one owners
    // usually un-hide (`AP_Ch2_internal: "false"`).
    domains: ["sensor"],
    name: "Active Power Ch2",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "W",
    hiddenByDefault: true,
  },
  jsy_positive_energy_ch2: {
    domains: ["sensor"],
    name: "Positive Active Energy Ch2",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "kWh",
    hiddenByDefault: true,
  },
  jsy_negative_energy_ch2: {
    domains: ["sensor"],
    name: "Negative Active Energy Ch2",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "kWh",
    hiddenByDefault: true,
  },
  jsy_power_factor_ch2: {
    domains: ["sensor"],
    name: "Power Factor Ch2",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "%",
    hiddenByDefault: true,
  },
  jsy_power_direction_ch2: {
    domains: ["sensor"],
    name: "Power Direction Ch2",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    hiddenByDefault: true,
  },
  jsy_frequency: {
    domains: ["sensor"],
    name: "Frequency",
    owner: "jsy-mk-194t_common",
    section: "diagnostics",
    unit: "Hz",
    hiddenByDefault: true,
  },
  // `Voltage Ch2` is commented out in jsy-mk-194t_common.yaml even though its
  // `U_Ch2_internal` substitution exists. Not a role until the firmware
  // publishes it.
};

/** Scheduler roles, whose names are built from `scheduler_unique_id`. */
export const SCHEDULER_CATALOG: Record<SchedulerRole, SchedulerRoleDefinition> = {
  activate: {
    domains: ["switch"],
    nameTemplate: "Activate {id} Scheduler",
  },
  router_level: {
    domains: ["number"],
    nameTemplate: "{id} Scheduler Router Level",
    unit: "%",
  },
  checking_end_threshold: {
    // No unit in the firmware; `max_value: 720 #12 hours max` says minutes.
    domains: ["number"],
    nameTemplate: "{id} Scheduler Checking End Threshold",
    unit: "min",
  },
  begin_hour: {
    domains: ["number"],
    nameTemplate: "{id} Scheduler Begin Hour",
    unit: "h",
  },
  begin_minute: {
    domains: ["number"],
    nameTemplate: "{id} Scheduler Begin Minute",
    unit: "min",
  },
  end_hour: {
    domains: ["number"],
    nameTemplate: "{id} Scheduler End Hour",
    unit: "h",
  },
  end_minute: {
    domains: ["number"],
    nameTemplate: "{id} Scheduler End Minute",
    unit: "min",
  },
};

export function schedulerEntityName(role: SchedulerRole, instanceId: string): string {
  return SCHEDULER_CATALOG[role].nameTemplate.replace("{id}", instanceId);
}

/**
 * How scheduler instances are enumerated: any `number` whose name ends in
 * ` Scheduler Router Level` is one, and the capture is its
 * `scheduler_unique_id`. Never hard-code `Forced` — it is only the default of
 * a substitution, and the firmware documents running several instances.
 */
export const SCHEDULER_ANCHOR: {
  readonly domain: Domain;
  readonly namePattern: RegExp;
  readonly slugPattern: RegExp;
} = {
  domain: "number",
  namePattern: /^(.+) Scheduler Router Level$/,
  slugPattern: /^(.+)_scheduler_router_level$/,
};

/**
 * Engine signatures, most specific first — the first that matches wins.
 *
 * The order carries information: `engine_1dimmer_2switches` also publishes
 * `Target grid exchange`, so the generic dimmer test has to come last, and
 * `Relay 3 Countdown` only exists on the bypass variant, so it comes first.
 * None of these signals is hidden by a substitution, which is what makes the
 * whole thing dependable.
 */
export const ENGINE_SIGNATURES: readonly {
  readonly engine: EngineId;
  readonly allOf: readonly Role[];
}[] = [
  { engine: "engine_1dimmer_2switches_1bypass", allOf: ["relay_3_countdown"] },
  { engine: "engine_1dimmer_2switches", allOf: ["relay_1_countdown", "relay_2_countdown"] },
  { engine: "engine_1dimmer_1bypass", allOf: ["bypass_relay"] },
  { engine: "engine_1switch", allOf: ["start_power_level"] },
  { engine: "engine_1dimmer", allOf: ["target_grid_exchange"] },
];

/** Module signatures. `allOf` roles must all be present, `anyOf` at least one. */
export const MODULE_SIGNATURES: readonly {
  readonly module: ModuleId;
  readonly allOf?: readonly Role[];
  readonly anyOf?: readonly Role[];
}[] = [
  { module: "power_meter", allOf: ["real_power"] },
  { module: "energy_counter_theorical", allOf: ["total_energy_diverted", "load_power"] },
  { module: "energy_counter_jsy-mk-194t", allOf: ["total_daily_energy_diverted"] },
  {
    module: "temperature_limiter",
    allOf: [
      "safety_temperature",
      "safety_limit_reached",
      "stop_temperature",
      "restart_temperature",
    ],
  },
  { module: "temperature_fan_control", allOf: ["fan_start_temperature", "fan_stop_temperature"] },
  { module: "power_meter_shelly_em3", allOf: ["em3_phase_a_power"] },
  {
    // Any un-hidden channel proves the package is loaded. All of them are
    // `internal: "true"` by default, so this module is only ever detected on a
    // device whose owner exposed a channel — there is no signal otherwise.
    module: "jsy-mk-194t_common",
    anyOf: (Object.keys(CATALOG) as Role[]).filter(
      (role) => CATALOG[role].owner === "jsy-mk-194t_common",
    ),
  },
  { module: "common", allOf: ["restart", "uptime"] },
  { module: "debug_sensors", allOf: ["device_info", "free_psram"] },
];

/** Display order of the recognised modules, so the summary is stable. */
export const MODULE_ORDER: readonly ModuleId[] = [
  "power_meter",
  "power_meter_shelly_em3",
  "jsy-mk-194t_common",
  "engine_1dimmer",
  "engine_1dimmer_1bypass",
  "engine_1dimmer_2switches",
  "engine_1dimmer_2switches_1bypass",
  "engine_1switch",
  "energy_counter_theorical",
  "energy_counter_jsy-mk-194t",
  "temperature_limiter",
  "temperature_fan_control",
  "scheduler_forced_run",
  "common",
  "debug_sensors",
];
