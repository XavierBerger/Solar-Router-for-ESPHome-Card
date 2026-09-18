# AGENTS.md

## Project

This repository holds two components:

- a **Home Assistant Lovelace card** for a solar router driven by ESPHome;
- **`fronius-simulator/`**, a Rust service that emulates a Fronius inverter and
  smart meter over the Fronius Solar API v1, plus a static energy viewer served
  on `/`. It exists so the card and the Home Assistant integration can be
  developed without the physical hardware.

See [docs/FRONIUS_SIMULATOR.md](docs/FRONIUS_SIMULATOR.md) for the endpoint
reference and simulation model, and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
for the Home Assistant container.

## Development Environment

### Docker

A **Docker environment** is provided for local development with Home Assistant.

- Configuration file: `docker/docker-compose.yml`
- Containers: `ha-dev` (`ghcr.io/home-assistant/home-assistant:stable`) and
  `fronius-simulator`, on the same network
- Ports: `8123` for Home Assistant, `8080` for the simulator and its viewer
- Volumes: `docker/ha-config` persists the Home Assistant configuration;
  `fronius-simulator/viewer` is bind-mounted read-only into the simulator, so
  viewer edits need no image rebuild

To start it:

```bash
cd docker
docker compose up -d
```

Home Assistant is then on http://localhost:8123, the simulator on
http://localhost:8080, and the viewer on http://localhost:8080/. Rebuild the
simulator after a Rust change with `docker/update-fronius-simulator.sh`.

### Simulator and viewer

Run from `fronius-simulator/`, never from the repository root: the viewer
directory is resolved against the process working directory, and starting the
binary elsewhere serves a 404 dashboard. The binary prints the path it resolved
at startup, or warns if it found nothing.

```bash
cd fronius-simulator

cargo test                              # 30 tests
cargo clippy --all-targets              # no warnings expected
cargo fmt --check
node --test 'viewer-tests/*.test.js'    # 10 tests, Node >= 18, no npm install

cargo run -- --day-duration-seconds 600 # one simulated day in 10 real minutes
```

## Rules for Agents

- Always use the Docker environment to test modifications
- Never modify production configuration directly without prior testing
- Respect the existing project structure
- Follow Home Assistant best practices for custom components
- Rust and JavaScript changes must keep both suites green, `clippy` free of
  warnings and `cargo fmt --check` silent; the CI runs exactly these four
  commands
- Code, comments and commit messages are written in English
