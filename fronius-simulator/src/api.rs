use std::{sync::Arc, time::Instant};

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use tower_http::services::ServeDir;

use crate::{
    config::Config,
    day::DayData,
    simulation::{InverterStatus, Sample, Simulation},
};

#[derive(Clone)]
pub struct AppState {
    config: Config,
    simulation: Simulation,
    started_at: Instant,
    /// Pre-rendered /simulation/day body. It only depends on the configuration,
    /// so building it once avoids re-integrating the whole day on every request.
    day_json: Bytes,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let simulation = Simulation::new(&config);
        let day = DayData::from_simulation(&simulation, DAY_SAMPLE_STEP_SECONDS);
        let day_json = Bytes::from(serde_json::to_vec(&day).expect("DayData is serializable"));

        Self {
            config,
            simulation,
            started_at: Instant::now(),
            day_json,
        }
    }

    fn sample(&self) -> Sample {
        self.simulation
            .sample_real_elapsed(self.started_at.elapsed().as_secs_f64())
    }
}

/// Simulated grid: three phases at 230 V, the European domestic standard the
/// Fronius payloads report.
const PHASE_VOLTAGE_V: f64 = 230.0;
const PHASE_COUNT: f64 = 3.0;

/// Sampling step of /simulation/day, in simulated seconds.
const DAY_SAMPLE_STEP_SECONDS: u64 = 10;

/// Static viewer root, resolved against the process working directory.
pub const VIEWER_DIR: &str = "viewer";

pub fn router(config: Config) -> Router {
    let state = Arc::new(AppState::new(config));

    let api_routes = Router::new()
        .route("/solar_api/GetAPIVersion.cgi", get(api_version))
        .route("/solar_api/v1/GetLoggerInfo.cgi", get(logger_info))
        .route("/solar_api/v1/GetInverterInfo.cgi", get(inverter_info))
        .route(
            "/solar_api/v1/GetPowerFlowRealtimeData.fcgi",
            get(power_flow),
        )
        .route(
            "/solar_api/v1/GetInverterRealtimeData.cgi",
            get(inverter_realtime_data),
        )
        .route(
            "/solar_api/v1/GetMeterRealtimeData.cgi",
            get(meter_realtime_data),
        )
        .route(
            "/solar_api/v1/GetOhmPilotRealtimeData.cgi",
            get(empty_system_collection),
        )
        .route(
            "/solar_api/v1/GetStorageRealtimeData.cgi",
            get(empty_system_collection),
        )
        .route(
            "/solar_api/v1/GetActiveDeviceInfo.cgi",
            get(active_device_info),
        )
        .route("/simulation/day", get(simulation_day))
        .with_state(state);

    // Serve the viewer on / while keeping the API routes ahead of it.
    api_routes.fallback_service(ServeDir::new(VIEWER_DIR))
}

async fn simulation_day(State(state): State<Arc<AppState>>) -> Response {
    (
        [(header::CONTENT_TYPE, "application/json")],
        state.day_json.clone(),
    )
        .into_response()
}

async fn api_version() -> Json<Value> {
    Json(json!({
        "APIVersion": 1,
        "BaseURL": "/solar_api/v1/",
        "CompatibilityRange": "1.8-1"
    }))
}

async fn logger_info() -> Json<Value> {
    Json(envelope_with_body(json!({
        "LoggerInfo": {
            "CO2Factor": 0.53,
            "CO2Unit": "kg",
            "CashCurrency": "EUR",
            "CashFactor": 0.22,
            "DeliveryFactor": 0.08,
            "HWVersion": "Rust simulator",
            "SWVersion": env!("CARGO_PKG_VERSION"),
            "PlatformID": "fronius-simulator",
            "ProductID": "Datalogger Web",
            "TimezoneLocation": "Europe/Paris",
            "TimezoneName": "CET",
            "UTCOffset": 3_600,
            "UniqueID": "SIM-DATALOGGER-001"
        }
    })))
}

async fn inverter_info(State(state): State<Arc<AppState>>) -> Json<Value> {
    let sample = state.sample();
    Json(envelope(json!({
        "1": {
            "CustomName": state.config.site_name,
            "DT": "Fronius Symo 5.0-3-M",
            "ErrorCode": 0,
            "PVPower": round(sample.pv_power_w),
            "Show": 1,
            "StatusCode": sample.status.code(),
            "UniqueID": "SIM-INVERTER-001"
        }
    })))
}

async fn power_flow(State(state): State<Arc<AppState>>) -> Json<Value> {
    let sample = state.sample();
    Json(envelope(json!({
        "Version": "12",
        "Site": {
            "E_Day": round(sample.energy_day_wh),
            "E_Total": round(sample.energy_total_wh),
            "E_Year": round(sample.energy_year_wh),
            "Meter_Location": "grid",
            "Mode": "meter",
            "P_Akku": null,
            "P_Grid": round(sample.grid_power_w),
            "P_Load": round(-sample.load_power_w),
            "P_PV": round(sample.pv_power_w),
            "rel_Autonomy": sample.autonomy_percent,
            "rel_SelfConsumption": sample.self_consumption_percent
        },
        "Inverters": {
            "1": {
                "DT": "Fronius Symo 5.0-3-M",
                "E_Day": round(sample.energy_day_wh),
                "E_Total": round(sample.energy_total_wh),
                "E_Year": round(sample.energy_year_wh),
                "P": round(sample.pv_power_w)
            }
        }
    })))
}

#[derive(Debug, Deserialize)]
struct InverterQuery {
    #[serde(rename = "Scope")]
    scope: Option<String>,
    #[serde(rename = "DeviceId")]
    device_id: Option<String>,
    #[serde(rename = "DeviceIndex")]
    device_index: Option<String>,
    #[serde(rename = "DataCollection")]
    data_collection: Option<String>,
}

async fn inverter_realtime_data(
    State(state): State<Arc<AppState>>,
    Query(query): Query<InverterQuery>,
) -> Json<Value> {
    let scope = query.scope.as_deref().unwrap_or("System");
    let collection = query
        .data_collection
        .as_deref()
        .unwrap_or("CumulationInverterData");
    let device_id = query
        .device_id
        .as_deref()
        .or(query.device_index.as_deref())
        .unwrap_or("1");
    let sample = state.sample();

    if scope.eq_ignore_ascii_case("System") {
        return Json(envelope(system_inverter_data(&sample)));
    }

    if !scope.eq_ignore_ascii_case("Device") || device_id != "1" {
        return Json(error_envelope(6, "Argument Error"));
    }

    let data = match collection {
        "CommonInverterData" => common_inverter_data(&sample),
        "CumulationInverterData" => cumulative_inverter_data(&sample),
        "3PInverterData" => three_phase_inverter_data(&sample),
        _ => return Json(error_envelope(6, "Argument Error")),
    };

    Json(envelope(data))
}

#[derive(Debug, Deserialize)]
struct MeterQuery {
    #[serde(rename = "Scope")]
    scope: Option<String>,
    #[serde(rename = "DeviceId")]
    device_id: Option<String>,
}

async fn meter_realtime_data(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MeterQuery>,
) -> Json<Value> {
    let scope = query.scope.as_deref().unwrap_or("System");
    let device_id = query.device_id.as_deref().unwrap_or("0");
    let sample = state.sample();
    let meter = meter_data(&sample);

    if scope.eq_ignore_ascii_case("System") {
        return Json(envelope(json!({ "0": meter })));
    }

    if scope.eq_ignore_ascii_case("Device") && device_id == "0" {
        return Json(envelope(meter));
    }

    Json(error_envelope(6, "Argument Error"))
}

async fn empty_system_collection() -> Json<Value> {
    Json(envelope(json!({})))
}

async fn active_device_info() -> Json<Value> {
    Json(envelope(json!({
        "Inverter": {
            "1": {
                "DT": "Fronius Symo 5.0-3-M",
                "Serial": "SIM-INVERTER-001"
            }
        },
        "Meter": {
            "0": {
                "Serial": "SIM-METER-001"
            }
        }
    })))
}

fn system_inverter_data(sample: &Sample) -> Value {
    json!({
        "DAY_ENERGY": {
            "Unit": "Wh",
            "Values": { "1": round(sample.energy_day_wh) }
        },
        "TOTAL_ENERGY": {
            "Unit": "Wh",
            "Values": { "1": round(sample.energy_total_wh) }
        },
        "YEAR_ENERGY": {
            "Unit": "Wh",
            "Values": { "1": round(sample.energy_year_wh) }
        },
        "PAC": {
            "Unit": "W",
            "Values": { "1": round(sample.pv_power_w) }
        }
    })
}

fn common_inverter_data(sample: &Sample) -> Value {
    let voltage_dc = if sample.pv_power_w > 0.0 { 510.0 } else { 0.0 };
    let current_dc = if voltage_dc > 0.0 {
        sample.pv_power_w / voltage_dc
    } else {
        0.0
    };
    let current_ac = phase_current_a(sample.pv_power_w);

    json!({
        "DAY_ENERGY": { "Value": round(sample.energy_day_wh), "Unit": "Wh" },
        "TOTAL_ENERGY": { "Value": round(sample.energy_total_wh), "Unit": "Wh" },
        "YEAR_ENERGY": { "Value": round(sample.energy_year_wh), "Unit": "Wh" },
        "FAC": { "Value": 50.0, "Unit": "Hz" },
        "IAC": { "Value": round_one(current_ac), "Unit": "A" },
        "IDC": { "Value": round_one(current_dc), "Unit": "A" },
        "PAC": { "Value": round(sample.pv_power_w), "Unit": "W" },
        "UAC": { "Value": PHASE_VOLTAGE_V, "Unit": "V" },
        "UDC": { "Value": voltage_dc, "Unit": "V" },
        "DeviceStatus": {
            "ErrorCode": 0,
            "InverterState": sample.status.state(),
            "LEDColor": if sample.status == InverterStatus::Running { 2 } else { 0 },
            "LEDState": 1,
            "StatusCode": sample.status.code()
        }
    })
}

fn cumulative_inverter_data(sample: &Sample) -> Value {
    json!({
        "DAY_ENERGY": { "Value": round(sample.energy_day_wh), "Unit": "Wh" },
        "TOTAL_ENERGY": { "Value": round(sample.energy_total_wh), "Unit": "Wh" },
        "YEAR_ENERGY": { "Value": round(sample.energy_year_wh), "Unit": "Wh" },
        "PAC": { "Value": round(sample.pv_power_w), "Unit": "W" }
    })
}

/// Per-phase AC current for a balanced three-phase load. Negative or zero power
/// yields no current rather than a sign the meter would never report.
fn phase_current_a(power_w: f64) -> f64 {
    if power_w > 0.0 {
        power_w / PHASE_VOLTAGE_V / PHASE_COUNT
    } else {
        0.0
    }
}

fn three_phase_inverter_data(sample: &Sample) -> Value {
    let phase_current = phase_current_a(sample.pv_power_w);

    json!({
        "IAC_L1": { "Value": round_one(phase_current), "Unit": "A" },
        "IAC_L2": { "Value": round_one(phase_current), "Unit": "A" },
        "IAC_L3": { "Value": round_one(phase_current), "Unit": "A" },
        "UAC_L1": { "Value": PHASE_VOLTAGE_V, "Unit": "V" },
        "UAC_L2": { "Value": PHASE_VOLTAGE_V, "Unit": "V" },
        "UAC_L3": { "Value": PHASE_VOLTAGE_V, "Unit": "V" }
    })
}

fn meter_data(sample: &Sample) -> Value {
    let phase_power = sample.grid_power_w / PHASE_COUNT;
    let phase_current = phase_power.abs() / PHASE_VOLTAGE_V;

    json!({
        "Current_AC_Phase_1": round_one(phase_current),
        "Current_AC_Phase_2": round_one(phase_current),
        "Current_AC_Phase_3": round_one(phase_current),
        "EnergyReal_WAC_Sum_Consumed": round(sample.grid_import_total_wh),
        "EnergyReal_WAC_Sum_Produced": round(sample.grid_export_total_wh),
        "Frequency_Phase_Average": 50.0,
        "Meter_Location_Current": 0,
        "PowerApparent_S_Sum": round(sample.grid_power_w.abs()),
        "PowerFactor_Sum": 0.99,
        "PowerReal_P_Phase_1": round(phase_power),
        "PowerReal_P_Phase_2": round(phase_power),
        "PowerReal_P_Phase_3": round(phase_power),
        "PowerReal_P_Sum": round(sample.grid_power_w),
        "Voltage_AC_Phase_1": PHASE_VOLTAGE_V,
        "Voltage_AC_Phase_2": PHASE_VOLTAGE_V,
        "Voltage_AC_Phase_3": PHASE_VOLTAGE_V,
        "Enable": 1,
        "Visible": 1,
        "Details": {
            "Manufacturer": "Fronius",
            "Model": "Smart Meter TS 65A-3",
            "Serial": "SIM-METER-001"
        }
    })
}

fn envelope(data: Value) -> Value {
    envelope_with_body(json!({ "Data": data }))
}

fn envelope_with_body(body: Value) -> Value {
    json!({
        "Head": ok_head(),
        "Body": body
    })
}

fn error_envelope(code: u16, reason: &str) -> Value {
    json!({
        "Head": {
            "RequestArguments": {},
            "Status": {
                "Code": code,
                "Reason": reason,
                "UserMessage": ""
            },
            "Timestamp": timestamp()
        },
        "Body": {
            "Data": {}
        }
    })
}

fn ok_head() -> Value {
    json!({
        "RequestArguments": {},
        "Status": {
            "Code": 0,
            "Reason": "",
            "UserMessage": ""
        },
        "Timestamp": timestamp()
    })
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn round(value: f64) -> i64 {
    value.round() as i64
}

fn round_one(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::router;
    use crate::config::Config;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    async fn get_json(path: &str) -> Value {
        let response = router(Config {
            start_time_seconds: 12.0 * 3_600.0,
            ..Config::default()
        })
        .oneshot(
            axum::http::Request::builder()
                .uri(path)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

        assert!(response.status().is_success());
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn simulation_day_returns_full_day_data() {
        let body = get_json("/simulation/day").await;
        assert_eq!(body["step_seconds"], 10);
        assert_eq!(body["sample_count"], 8_640);
        assert_eq!(body["duration_seconds"], 86_400);
        assert_eq!(body["samples"][0]["time"], "00:00:00");
        assert_eq!(body["samples"][8_639]["time"], "23:59:50");
        assert!(body["summary"]["pv_energy_wh"].as_f64().unwrap() > 0.0);
    }

    #[tokio::test]
    async fn simulation_day_is_served_as_json() {
        let response = router(Config::default())
            .oneshot(
                axum::http::Request::builder()
                    .uri("/simulation/day")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.headers()[axum::http::header::CONTENT_TYPE],
            "application/json"
        );
    }

    #[tokio::test]
    async fn api_version_has_v1_base_url() {
        let body = get_json("/solar_api/GetAPIVersion.cgi").await;
        assert_eq!(body["APIVersion"], 1);
        assert_eq!(body["BaseURL"], "/solar_api/v1/");
    }

    #[tokio::test]
    async fn logger_info_uses_logger_info_body_shape() {
        let body = get_json("/solar_api/v1/GetLoggerInfo.cgi").await;
        assert_eq!(body["Head"]["Status"]["Code"], 0);
        assert_eq!(body["Body"]["LoggerInfo"]["UniqueID"], "SIM-DATALOGGER-001");
    }

    #[tokio::test]
    async fn inverter_info_exposes_one_inverter() {
        let body = get_json("/solar_api/v1/GetInverterInfo.cgi").await;
        assert_eq!(body["Head"]["Status"]["Code"], 0);
        assert_eq!(body["Body"]["Data"]["1"]["UniqueID"], "SIM-INVERTER-001");
    }

    #[tokio::test]
    async fn power_flow_contains_site_and_inverter_data() {
        let body = get_json("/solar_api/v1/GetPowerFlowRealtimeData.fcgi").await;
        assert_eq!(body["Head"]["Status"]["Code"], 0);
        assert!(body["Body"]["Data"]["Site"]["P_PV"].as_i64().unwrap() > 0);
        assert!(
            body["Body"]["Data"]["Inverters"]["1"]["P"]
                .as_i64()
                .unwrap()
                > 0
        );
    }

    #[tokio::test]
    async fn common_inverter_device_query_returns_common_data() {
        let body = get_json(
            "/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=1&DataCollection=CommonInverterData",
        )
        .await;
        assert_eq!(body["Head"]["Status"]["Code"], 0);
        assert!(body["Body"]["Data"]["PAC"]["Value"].as_i64().unwrap() > 0);
        assert_eq!(body["Body"]["Data"]["DeviceStatus"]["StatusCode"], 7);
    }

    #[tokio::test]
    async fn system_meter_query_returns_meter_map() {
        let body = get_json("/solar_api/v1/GetMeterRealtimeData.cgi?Scope=System").await;
        assert_eq!(body["Head"]["Status"]["Code"], 0);
        assert!(body["Body"]["Data"]["0"]["PowerReal_P_Sum"].is_number());
    }

    #[tokio::test]
    async fn device_meter_query_returns_single_meter() {
        let body = get_json("/solar_api/v1/GetMeterRealtimeData.cgi?Scope=Device&DeviceId=0").await;
        assert_eq!(body["Head"]["Status"]["Code"], 0);
        assert_eq!(body["Body"]["Data"]["Details"]["Serial"], "SIM-METER-001");
    }

    #[tokio::test]
    async fn storage_collection_is_empty_but_valid() {
        let body = get_json("/solar_api/v1/GetStorageRealtimeData.cgi?Scope=System").await;

        assert_eq!(body["Head"]["Status"]["Code"], 0);
        assert_eq!(body["Body"]["Data"].as_object().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn ohmpilot_collection_is_empty_but_valid() {
        let body = get_json("/solar_api/v1/GetOhmPilotRealtimeData.cgi?Scope=System").await;

        assert_eq!(body["Head"]["Status"]["Code"], 0);
        assert_eq!(body["Body"]["Data"].as_object().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn bad_device_query_returns_fronius_argument_error() {
        let body = get_json(
            "/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=99&DataCollection=CommonInverterData",
        )
        .await;
        assert_eq!(body["Head"]["Status"]["Code"], 6);
    }
}
