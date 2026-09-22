# Fronius Simulator

This project includes a Rust service that simulates a single residential Fronius inverter and smart meter for the Home Assistant Fronius integration. It speaks the Fronius Solar API HTTP v1 only; Modbus and SunSpec are intentionally not implemented.

## Architecture

The simulator lives in `fronius-simulator/`.

- `src/simulation.rs` contains the deterministic energy model.
- `src/api.rs` exposes Fronius Solar API v1-compatible HTTP JSON endpoints.
- `src/day.rs` builds the full-day dataset behind `/simulation/day`.
- `src/config.rs` reads environment variables and CLI flags.
- `viewer/` is the static energy dashboard served on `/`.
- `viewer-tests/` holds its test suites, run by Node's built-in runner.
- `Dockerfile` builds the Rust binary with a multi-stage Docker build.

The Docker Compose development environment starts the simulator on the same Docker network as Home Assistant. Configure the Fronius integration with this host from inside Home Assistant:

```text
http://fronius-simulator:8080
```

## API Endpoints

Implemented endpoints:

- `/solar_api/GetAPIVersion.cgi`
- `/solar_api/v1/GetLoggerInfo.cgi`
- `/solar_api/v1/GetInverterInfo.cgi`
- `/solar_api/v1/GetPowerFlowRealtimeData.fcgi`
- `/solar_api/v1/GetInverterRealtimeData.cgi?Scope=System`
- `/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=1&DataCollection=CommonInverterData`
- `/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=1&DataCollection=CumulationInverterData`
- `/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=1&DataCollection=3PInverterData`
- `/solar_api/v1/GetMeterRealtimeData.cgi?Scope=System`
- `/solar_api/v1/GetMeterRealtimeData.cgi?Scope=Device&DeviceId=0`
- `/solar_api/v1/GetActiveDeviceInfo.cgi?DeviceClass=System`
- `/solar_api/v1/GetStorageRealtimeData.cgi?Scope=System`
- `/solar_api/v1/GetOhmPilotRealtimeData.cgi?Scope=System`

Unsupported optional storage and Ohmpilot collections return successful empty `Body.Data` objects. This lets Home Assistant skip those optional devices without failing setup.

## Simulation Day Endpoint

`/simulation/day` is not part of the Fronius API. It returns one complete simulated day, independent of the accelerated clock, and is what the viewer charts.

```json
{
  "step_seconds": 10,
  "sample_count": 8640,
  "duration_seconds": 86400,
  "summary": {
    "pv_energy_wh": 17910.2,
    "load_energy_wh": 13510.0,
    "grid_import_wh": 9114.7,
    "grid_export_wh": 13515.0
  },
  "samples": [
    {
      "time": "12:30:00",
      "sim_time_seconds": 45000.0,
      "pv_power_w": 1847.2,
      "load_power_w": 3033.4,
      "grid_power_w": 1186.2
    }
  ]
}
```

Powers are watts rounded to 0.1 W, and `grid_power_w` is positive on import, negative on export. Samples carry only what the viewer reads; daily totals live in `summary`. The body depends solely on the configuration, so it is rendered once at startup and served from memory -- expect roughly half a second before the first response, then about 2 ms per request.

## Energy Viewer

The dashboard is served on `/`, straight from the `viewer/` directory. That path is resolved **against the process working directory**, so the simulator must be started from `fronius-simulator/`. The Docker environment bind-mounts the directory instead of baking it into the image, which means viewer edits show up on reload without rebuilding.

At startup the binary prints the directory it resolved:

```text
Fronius simulator listening on http://0.0.0.0:8080
Viewer served from /home/fronius/viewer
```

If that line is replaced by a `WARNING`, the viewer will answer 404 while the Fronius API keeps working.

## Simulation Model

The model simulates one PV inverter and one grid smart meter.

- PV production follows a wide clear-sky sine centred on 14:45, clipped by a horizon mask that stands for relief east and west of the array: nothing before 08:45, a steep ramp to 09:45, a long plateau, then a sharp fall between 18:45 and 19:50.
- Deterministic seeded cloud variation changes the clear-sky curve while keeping test runs repeatable.
- Load is a low baseline lifted by a slow occupancy swing, a fridge duty cycle, and a schedule of rectangular appliance runs -- the off-peak water heater from 00:00 to 01:40, the morning rush, midday and evening cooking, and two late loads. Every event edge sits on a five-minute grid, which keeps the energy integration exact over each rectangle.
- Grid power is calculated as `load - PV`; positive values are grid import, negative values are export.
- Fronius power-flow load is reported as a negative `P_Load`, matching the Solar API convention commonly consumed by Home Assistant clients.
- Daily PV energy resets at each simulated midnight. Year and total PV counters continue increasing across simulated days.
- The inverter reports status code `7` while producing and `13` while sleeping.

## Configuration

Environment variables:

| Variable                   | Default                         | Description                                      |
| -------------------------- | ------------------------------- | ------------------------------------------------ |
| `SIM_BIND`                 | `0.0.0.0:8080`                  | HTTP bind address                                |
| `SIM_DAY_DURATION_SECONDS` | `86400`                         | Real seconds per simulated day                   |
| `SIM_START_TIME`           | `06:00:00`                      | Simulated time of day at process start           |
| `SIM_PEAK_POWER_W`         | `2700`                          | PV peak power in watts                           |
| `SIM_BASE_LOAD_W`          | `230`                           | Residential baseline load in watts               |
| `SIM_SEED`                 | `17`                            | Deterministic cloud and appliance variation seed |
| `SIM_SITE_NAME`            | `Development Fronius Simulator` | Inverter custom name shown to clients            |

The same settings can be supplied as CLI flags:

```bash
fronius-simulator --day-duration-seconds 600 --start-time 08:00 --peak-power-w 6500
```

The default array is deliberately a third smaller than the real installation the
curves were traced from, so that surplus is not permanent and the router has
something to arbitrate. Pass `--peak-power-w 3950` to get the reference day back.

## Running With Docker

From the `docker` directory:

```bash
docker compose build fronius-simulator
docker compose up -d
```

Home Assistant is available at http://localhost:8123. Add the Fronius integration and use `http://fronius-simulator:8080` as the host.

To simulate a full day in ten minutes, add this environment variable to the `fronius-simulator` service in `docker/docker-compose.yml`:

```yaml
SIM_DAY_DURATION_SECONDS: "600"
```

To check the simulator from your host browser or terminal, add a temporary port mapping to the service:

```yaml
ports:
  - "8080:8080"
```

Then open:

```text
http://localhost:8080/solar_api/v1/GetPowerFlowRealtimeData.fcgi
```

## Local Development

Run from `fronius-simulator/`, not from the repository root: the viewer is resolved relative to the working directory, so `--manifest-path` from elsewhere starts a server whose dashboard answers 404.

```bash
cd fronius-simulator

cargo test                              # 30 tests
cargo clippy --all-targets              # no warnings expected
cargo fmt --check
node --test 'viewer-tests/*.test.js'    # 10 tests, Node >= 18, no npm install

cargo run -- --day-duration-seconds 600
```

The local server listens on http://0.0.0.0:8080 by default, with the viewer on http://localhost:8080/.

## HomeAssistant Fronius integration configuration

Add Fronius integration and set `10.89.2.2:8080` as host address.