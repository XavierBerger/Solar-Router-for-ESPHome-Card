use std::f64::consts::PI;

use crate::config::Config;

pub const DAY_SECONDS: f64 = 86_400.0;
const SUNRISE_SECONDS: f64 = 6.0 * 3_600.0;
const SUNSET_SECONDS: f64 = 20.0 * 3_600.0;
const TOTAL_BASE_ENERGY_WH: f64 = 9_800_000.0;
const YEAR_BASE_ENERGY_WH: f64 = 1_250_000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InverterStatus {
    Running,
    Sleeping,
}

impl InverterStatus {
    pub fn code(self) -> u16 {
        match self {
            Self::Running => 7,
            Self::Sleeping => 13,
        }
    }

    pub fn state(self) -> &'static str {
        match self {
            Self::Running => "Running",
            Self::Sleeping => "Sleeping",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Sample {
    pub sim_time_seconds: f64,
    pub day_seconds: f64,
    pub day_index: u64,
    pub pv_power_w: f64,
    pub load_power_w: f64,
    pub grid_power_w: f64,
    pub energy_day_wh: f64,
    pub energy_year_wh: f64,
    pub energy_total_wh: f64,
    pub grid_import_total_wh: f64,
    pub grid_export_total_wh: f64,
    pub self_consumption_percent: f64,
    pub autonomy_percent: f64,
    pub status: InverterStatus,
}

#[derive(Debug, Clone)]
pub struct Simulation {
    peak_power_w: f64,
    base_load_w: f64,
    seed: u64,
    start_time_seconds: f64,
    acceleration: f64,
}

impl Simulation {
    pub fn new(config: &Config) -> Self {
        Self {
            peak_power_w: config.peak_power_w,
            base_load_w: config.base_load_w,
            seed: config.seed,
            start_time_seconds: config.start_time_seconds,
            acceleration: DAY_SECONDS / config.day_duration.as_secs_f64(),
        }
    }

    pub fn simulated_seconds(&self, real_elapsed_seconds: f64) -> f64 {
        let elapsed_seconds = real_elapsed_seconds.max(0.0).floor();

        self.start_time_seconds + elapsed_seconds * self.acceleration
    }

    pub fn sample_real_elapsed(&self, real_elapsed_seconds: f64) -> Sample {
        self.sample_at_simulated_seconds(self.simulated_seconds(real_elapsed_seconds))
    }

    pub fn sample_at_simulated_seconds(&self, sim_time_seconds: f64) -> Sample {
        let sim_time_seconds = sim_time_seconds.max(0.0);
        let day_seconds = sim_time_seconds.rem_euclid(DAY_SECONDS);
        let day_index = (sim_time_seconds / DAY_SECONDS).floor() as u64;
        let pv_power_w = self.pv_power(day_seconds);
        let load_power_w = self.load_power(day_seconds);
        let grid_power_w = load_power_w - pv_power_w;
        let energy_day_wh = self.pv_energy_until(day_seconds);
        let day_yield_wh = self.pv_energy_until(DAY_SECONDS);
        let energy_since_epoch_wh = day_yield_wh * day_index as f64 + energy_day_wh;
        let grid_import_total_wh = self.grid_energy_until(day_seconds, GridDirection::Import)
            + self.grid_energy_until(DAY_SECONDS, GridDirection::Import) * day_index as f64;
        let grid_export_total_wh = self.grid_energy_until(day_seconds, GridDirection::Export)
            + self.grid_energy_until(DAY_SECONDS, GridDirection::Export) * day_index as f64;
        let self_consumption_percent = percent(if pv_power_w > 0.0 {
            pv_power_w.min(load_power_w) / pv_power_w
        } else {
            0.0
        });
        let autonomy_percent = percent(if load_power_w > 0.0 {
            (load_power_w - grid_power_w.max(0.0)) / load_power_w
        } else {
            1.0
        });
        let status = if pv_power_w > 25.0 {
            InverterStatus::Running
        } else {
            InverterStatus::Sleeping
        };

        Sample {
            sim_time_seconds,
            day_seconds,
            day_index,
            pv_power_w,
            load_power_w,
            grid_power_w,
            energy_day_wh,
            energy_year_wh: YEAR_BASE_ENERGY_WH + energy_since_epoch_wh,
            energy_total_wh: TOTAL_BASE_ENERGY_WH + energy_since_epoch_wh,
            grid_import_total_wh,
            grid_export_total_wh,
            self_consumption_percent,
            autonomy_percent,
            status,
        }
    }

    pub fn sample_day(&self, step_seconds: u64) -> Vec<Sample> {
        assert!(step_seconds > 0, "day sample step must be greater than zero");

        let step_seconds = step_seconds as f64;
        let mut samples = Vec::new();
        let mut day_seconds = 0.0;

        while day_seconds < DAY_SECONDS {
            samples.push(self.sample_at_simulated_seconds(day_seconds));
            day_seconds += step_seconds;
        }

        samples
    }

    pub fn pv_power(&self, day_seconds: f64) -> f64 {
        if !(SUNRISE_SECONDS..=SUNSET_SECONDS).contains(&day_seconds) {
            return 0.0;
        }

        let daylight_progress =
            (day_seconds - SUNRISE_SECONDS) / (SUNSET_SECONDS - SUNRISE_SECONDS);
        let clear_sky = (PI * daylight_progress).sin().max(0.0).powf(1.35);
        let cloud = self.cloud_factor(day_seconds);

        (self.peak_power_w * clear_sky * cloud).max(0.0)
    }

    pub fn load_power(&self, day_seconds: f64) -> f64 {
        let hour = day_seconds / 3_600.0;
        let morning = gaussian(hour, 7.2, 0.75) * 750.0;
        let lunch = gaussian(hour, 12.7, 1.1) * 260.0;
        let evening = gaussian(hour, 19.2, 1.35) * 1_150.0;
        let appliance = (hash_wave(self.seed ^ 0x9e37, day_seconds / 4_800.0) + 1.0) * 85.0;
        let occupancy = 90.0 * ((2.0 * PI * (hour - 17.0) / 24.0).sin() + 1.0);

        (self.base_load_w + morning + lunch + evening + appliance + occupancy).max(0.0)
    }

    pub fn pv_energy_until(&self, day_seconds: f64) -> f64 {
        integrate_wh(
            |second| self.pv_power(second),
            day_seconds.clamp(0.0, DAY_SECONDS),
        )
    }

    fn grid_energy_until(&self, day_seconds: f64, direction: GridDirection) -> f64 {
        integrate_wh(
            |second| {
                let grid = self.load_power(second) - self.pv_power(second);
                match direction {
                    GridDirection::Import => grid.max(0.0),
                    GridDirection::Export => (-grid).max(0.0),
                }
            },
            day_seconds.clamp(0.0, DAY_SECONDS),
        )
    }

    fn cloud_factor(&self, day_seconds: f64) -> f64 {
        let phase_a = seed_phase(self.seed, 0);
        let phase_b = seed_phase(self.seed, 1);
        let slow = (2.0 * PI * day_seconds / 19_000.0 + phase_a).sin();
        let fast = (2.0 * PI * day_seconds / 4_700.0 + phase_b).sin();

        (0.88 + 0.10 * slow + 0.06 * fast).clamp(0.62, 1.0)
    }
}

#[derive(Debug, Clone, Copy)]
enum GridDirection {
    Import,
    Export,
}

fn integrate_wh(mut power_at_second: impl FnMut(f64) -> f64, until_seconds: f64) -> f64 {
    if until_seconds <= 0.0 {
        return 0.0;
    }

    let step = 300.0;
    let mut elapsed = 0.0;
    let mut watt_seconds = 0.0;
    while elapsed < until_seconds {
        let next = (elapsed + step).min(until_seconds);
        let midpoint = (elapsed + next) / 2.0;
        watt_seconds += power_at_second(midpoint) * (next - elapsed);
        elapsed = next;
    }

    watt_seconds / 3_600.0
}

fn gaussian(value: f64, center: f64, width: f64) -> f64 {
    let x = (value - center) / width;
    (-0.5 * x * x).exp()
}

fn seed_phase(seed: u64, lane: u64) -> f64 {
    let mixed = splitmix64(seed ^ lane.wrapping_mul(0x9e37_79b9_7f4a_7c15));
    let fraction = mixed as f64 / u64::MAX as f64;
    fraction * 2.0 * PI
}

fn hash_wave(seed: u64, value: f64) -> f64 {
    (value + seed_phase(seed, 2)).sin() * 0.65 + (value * 2.71 + seed_phase(seed, 3)).sin() * 0.35
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = value;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn percent(value: f64) -> f64 {
    (value.clamp(0.0, 1.0) * 100.0 * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::{InverterStatus, Simulation, DAY_SECONDS};
    use crate::config::Config;
    use std::time::Duration;

    fn simulation() -> Simulation {
        Simulation::new(&Config {
            day_duration: Duration::from_secs(600),
            ..Config::default()
        })
    }

    #[test]
    fn solar_curve_is_zero_at_night_and_positive_at_noon() {
        let sim = simulation();
        assert_eq!(sim.pv_power(2.0 * 3_600.0), 0.0);
        assert!(sim.pv_power(12.5 * 3_600.0) > 3_000.0);
    }

    #[test]
    fn load_profile_has_morning_and_evening_peaks() {
        let sim = simulation();
        let night = sim.load_power(3.0 * 3_600.0);
        let morning = sim.load_power(7.2 * 3_600.0);
        let evening = sim.load_power(19.2 * 3_600.0);
        assert!(morning > night);
        assert!(evening > morning);
    }

    #[test]
    fn grid_power_imports_when_load_exceeds_pv_and_exports_when_pv_exceeds_load() {
        let sim = simulation();
        let night = sim.sample_at_simulated_seconds(2.0 * 3_600.0);
        let noon = sim.sample_at_simulated_seconds(12.5 * 3_600.0);

        assert!(night.grid_power_w > 0.0);
        assert!(noon.grid_power_w < 0.0);
    }

    #[test]
    fn time_acceleration_maps_real_seconds_to_simulated_day() {
        let sim = simulation();
        assert_eq!(sim.simulated_seconds(300.0), 64_800.0);
    }

    #[test]
    fn simulation_uses_one_second_real_time_ticks() {
        let sim = simulation();

        assert_eq!(
            sim.simulated_seconds(0.1),
            sim.simulated_seconds(0.0)
        );

        assert_eq!(
            sim.simulated_seconds(0.9),
            sim.simulated_seconds(0.0)
        );

        assert_eq!(
            sim.simulated_seconds(1.0) - sim.simulated_seconds(0.0),
            144.0
        );

        assert_eq!(
            sim.simulated_seconds(1.9) - sim.simulated_seconds(0.0),
            144.0
        );

        assert_eq!(
            sim.simulated_seconds(2.0) - sim.simulated_seconds(0.0),
            288.0
        );
    }

    #[test]
    fn accelerated_day_completes_after_configured_real_duration() {
        let sim = simulation();

        // 600 real seconds = one simulated day.
        assert_eq!(
            sim.simulated_seconds(600.0) - sim.simulated_seconds(0.0),
            86_400.0
        );
    }

    #[test]
    fn day_sampling_returns_every_minute_from_midnight_to_2359() {
        let sim = simulation();
        let samples = sim.sample_day(60);

        assert_eq!(samples.len(), 1_440);
        assert_eq!(samples.first().unwrap().day_seconds, 0.0);
        assert_eq!(samples.last().unwrap().day_seconds, DAY_SECONDS - 60.0);
        assert_eq!(samples.first().unwrap().sim_time_seconds, 0.0);
        assert_eq!(samples.last().unwrap().sim_time_seconds, DAY_SECONDS - 60.0);
    }

    #[test]
    fn day_sampling_reuses_the_existing_simulation_model() {
        let sim = simulation();
        let samples = sim.sample_day(60);

        assert_eq!(samples[120].day_seconds, 2.0 * 3_600.0);
        assert_eq!(samples[120].pv_power_w, 0.0);
        assert_eq!(samples[360].day_seconds, 6.0 * 3_600.0);
        assert_eq!(samples[360].pv_power_w, 0.0);
        assert!(samples[750].pv_power_w > 0.0);
        assert!(samples[750].energy_day_wh > samples[700].energy_day_wh);
        assert!(samples[1_439].energy_day_wh >= samples[750].energy_day_wh);
    }

    #[test]
    #[should_panic(expected = "day sample step must be greater than zero")]
    fn day_sampling_rejects_a_zero_step() {
        simulation().sample_day(0);
    }

    #[test]
    fn energy_counters_are_monotonic_across_simulated_days() {
        let sim = simulation();
        let morning = sim.sample_at_simulated_seconds(8.0 * 3_600.0);
        let evening = sim.sample_at_simulated_seconds(18.0 * 3_600.0);
        let next_morning = sim.sample_at_simulated_seconds(32.0 * 3_600.0);

        assert!(evening.energy_day_wh > morning.energy_day_wh);
        assert!(next_morning.energy_total_wh > evening.energy_total_wh);
        assert!(next_morning.energy_year_wh > evening.energy_year_wh);
    }

    #[test]
    fn inverter_status_follows_daylight_production() {
        let sim = simulation();
        assert_eq!(
            sim.sample_at_simulated_seconds(3.0 * 3_600.0).status,
            InverterStatus::Sleeping
        );
        assert_eq!(
            sim.sample_at_simulated_seconds(12.0 * 3_600.0).status,
            InverterStatus::Running
        );
    }

    #[test]
    fn seeded_cloud_variation_is_stable() {
        let sim_a = simulation();
        let sim_b = simulation();
        assert_eq!(
            sim_a.pv_power(11.0 * 3_600.0),
            sim_b.pv_power(11.0 * 3_600.0)
        );
    }
}
