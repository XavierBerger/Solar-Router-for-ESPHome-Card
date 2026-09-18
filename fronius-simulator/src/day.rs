use serde::Serialize;

use crate::simulation::{DAY_SECONDS, Sample, Simulation};

#[derive(Debug, Clone, Serialize)]
pub struct DayData {
    pub step_seconds: u64,
    pub sample_count: usize,
    pub duration_seconds: u64,
    pub summary: DaySummary,
    pub samples: Vec<DaySample>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaySummary {
    pub pv_energy_wh: f64,
    pub load_energy_wh: f64,
    pub grid_import_wh: f64,
    pub grid_export_wh: f64,
}

/// One point of the day curve. Deliberately narrow: the viewer reads the three
/// powers and the timestamp, and the daily totals belong to `DaySummary`.
#[derive(Debug, Clone, Serialize)]
pub struct DaySample {
    pub time: String,
    pub sim_time_seconds: f64,
    pub pv_power_w: f64,
    pub load_power_w: f64,
    pub grid_power_w: f64,
}

impl DayData {
    pub fn from_simulation(simulation: &Simulation, step_seconds: u64) -> Self {
        let samples = simulation
            .sample_day(step_seconds)
            .into_iter()
            .map(DaySample::from)
            .collect::<Vec<_>>();

        let totals = simulation.full_day_energy();
        let load_energy_wh = totals.pv_wh + totals.grid_import_wh - totals.grid_export_wh;

        Self {
            step_seconds,
            sample_count: samples.len(),
            duration_seconds: DAY_SECONDS as u64,
            summary: DaySummary {
                pv_energy_wh: totals.pv_wh,
                load_energy_wh,
                grid_import_wh: totals.grid_import_wh,
                grid_export_wh: totals.grid_export_wh,
            },
            samples,
        }
    }
}

impl From<Sample> for DaySample {
    fn from(sample: Sample) -> Self {
        let total_seconds = sample.day_seconds.floor() as u64;
        let hours = total_seconds / 3_600;
        let minutes = (total_seconds % 3_600) / 60;
        let seconds = total_seconds % 60;

        Self {
            time: format!("{hours:02}:{minutes:02}:{seconds:02}"),
            sim_time_seconds: sample.sim_time_seconds,
            pv_power_w: round_w(sample.pv_power_w),
            load_power_w: round_w(sample.load_power_w),
            grid_power_w: round_w(sample.grid_power_w),
        }
    }
}

/// 0.1 W is far finer than anything the model claims, and full f64 precision
/// costs about ten characters per value across 8640 samples.
fn round_w(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::DayData;
    use crate::config::Config;
    use crate::simulation::Simulation;
    use std::time::Duration;

    fn simulation() -> Simulation {
        Simulation::new(&Config {
            day_duration: Duration::from_secs(600),
            ..Config::default()
        })
    }

    #[test]
    fn day_data_has_api_friendly_metadata_and_summary() {
        let simulation = simulation();
        let day = DayData::from_simulation(&simulation, 60);
        let totals = simulation.full_day_energy();

        assert_eq!(day.step_seconds, 60);
        assert_eq!(day.sample_count, 1_440);
        assert_eq!(day.duration_seconds, 86_400);
        assert!((day.summary.pv_energy_wh - totals.pv_wh).abs() < 1e-9);
        assert!((day.summary.grid_import_wh - totals.grid_import_wh).abs() < 1e-9);
        assert!((day.summary.grid_export_wh - totals.grid_export_wh).abs() < 1e-9);
        assert!(
            (day.summary.load_energy_wh
                - (totals.pv_wh + totals.grid_import_wh - totals.grid_export_wh))
                .abs()
                < 1e-9
        );
        assert!(day.summary.pv_energy_wh > 0.0);
        assert!(day.summary.load_energy_wh > 0.0);
        assert!(day.summary.grid_import_wh > 0.0);
        assert!(day.summary.grid_export_wh > 0.0);
    }

    #[test]
    fn day_samples_carry_only_what_the_viewer_reads() {
        let day = DayData::from_simulation(&simulation(), 60);
        let json = serde_json::to_value(&day.samples[720]).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();

        assert_eq!(
            keys,
            [
                "grid_power_w",
                "load_power_w",
                "pv_power_w",
                "sim_time_seconds",
                "time"
            ]
        );
    }

    #[test]
    fn day_sample_powers_are_rounded_to_a_tenth_of_a_watt() {
        let day = DayData::from_simulation(&simulation(), 60);
        let noon = &day.samples[720];

        for power in [noon.pv_power_w, noon.load_power_w, noon.grid_power_w] {
            assert_eq!(power, (power * 10.0).round() / 10.0);
        }
        assert!(noon.pv_power_w > 0.0);
    }

    #[test]
    fn day_samples_have_hh_mm_ss_timestamps() {
        let day = DayData::from_simulation(&simulation(), 10);

        assert_eq!(day.samples.first().unwrap().time, "00:00:00");
        assert_eq!(day.samples[1].time, "00:00:10");
        assert_eq!(day.samples.last().unwrap().time, "23:59:50");
        assert_eq!(day.samples[4_500].time, "12:30:00");
    }
}
