use serde::Serialize;

use crate::simulation::{Sample, Simulation, DAY_SECONDS};

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

#[derive(Debug, Clone, Serialize)]
pub struct DaySample {
    pub time: String,
    pub sim_time_seconds: f64,
    pub pv_power_w: f64,
    pub load_power_w: f64,
    pub grid_power_w: f64,
    pub energy_day_wh: f64,
    pub grid_import_total_wh: f64,
    pub grid_export_total_wh: f64,
    pub self_consumption_percent: f64,
    pub autonomy_percent: f64,
    pub status: &'static str,
}

impl DayData {
    pub fn from_simulation(simulation: &Simulation, step_seconds: u64) -> Self {
        assert!(step_seconds > 0, "day sample step must be greater than zero");

        let samples = simulation
            .sample_day(step_seconds)
            .into_iter()
            .map(DaySample::from)
            .collect::<Vec<_>>();

        let final_sample = samples
            .last()
            .expect("a full day must contain at least one sample");
        let pv_energy_wh = simulation.pv_energy_until(DAY_SECONDS);
        let grid_import_wh = final_sample.grid_import_total_wh;
        let grid_export_wh = final_sample.grid_export_total_wh;
        let load_energy_wh = pv_energy_wh + grid_import_wh - grid_export_wh;

        Self {
            step_seconds,
            sample_count: samples.len(),
            duration_seconds: DAY_SECONDS as u64,
            summary: DaySummary {
                pv_energy_wh,
                load_energy_wh,
                grid_import_wh,
                grid_export_wh,
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

        Self {
            time: format!("{hours:02}:{minutes:02}"),
            sim_time_seconds: sample.sim_time_seconds,
            pv_power_w: sample.pv_power_w,
            load_power_w: sample.load_power_w,
            grid_power_w: sample.grid_power_w,
            energy_day_wh: sample.energy_day_wh,
            grid_import_total_wh: sample.grid_import_total_wh,
            grid_export_total_wh: sample.grid_export_total_wh,
            self_consumption_percent: sample.self_consumption_percent,
            autonomy_percent: sample.autonomy_percent,
            status: sample.status.state(),
        }
    }
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
        let day = DayData::from_simulation(&simulation(), 60);

        assert_eq!(day.step_seconds, 60);
        assert_eq!(day.sample_count, 1_440);
        assert_eq!(day.duration_seconds, 86_400);
        assert!(day.summary.pv_energy_wh > 0.0);
        assert!(day.summary.load_energy_wh > 0.0);
        assert!(day.summary.grid_import_wh > 0.0);
        assert!(day.summary.grid_export_wh > 0.0);
    }

    #[test]
    fn day_samples_have_hh_mm_timestamps() {
        let day = DayData::from_simulation(&simulation(), 60);

        assert_eq!(day.samples.first().unwrap().time, "00:00");
        assert_eq!(day.samples.last().unwrap().time, "23:59");
        assert_eq!(day.samples[750].time, "12:30");
    }
}
