# Solar Router for ESPHome -- Card

A Home Assistant Lovelace card for a solar router driven by ESPHome, together
with the development tooling needed to build it without the physical hardware.

## Components

| Path | What it is |
|---|---|
| `fronius-simulator/` | Rust service emulating a Fronius inverter and smart meter over the Solar API v1, plus a static energy viewer |
| `docker/` | Home Assistant development container, wired to the simulator |
| `docs/` | Development environment and simulator reference |

## Quick start

```bash
cd docker
docker compose up -d
```

- Home Assistant: http://localhost:8123
- Simulator API: http://localhost:8080 -- use `http://fronius-simulator:8080`
  as the host when adding the Fronius integration from inside Home Assistant
- Energy viewer: http://localhost:8080/

## Working on the simulator

Run from `fronius-simulator/`, not from the repository root: the viewer is
resolved against the process working directory.

```bash
cd fronius-simulator

cargo test                              # Rust, 30 tests
cargo clippy --all-targets
cargo fmt --check
node --test 'viewer-tests/*.test.js'    # viewer, 10 tests, Node >= 18, no npm install

cargo run -- --day-duration-seconds 600 # one simulated day in 10 real minutes
```

No npm install is required at any point: the viewer ships plain ES modules and a
vendored copy of uPlot, and its tests use Node's built-in runner.

## Documentation

- [Development environment](docs/DEVELOPMENT.md)
- [Fronius simulator](docs/FRONIUS_SIMULATOR.md) -- endpoints, simulation model,
  configuration, and the `/simulation/day` payload the viewer consumes

## License

See [LICENSE](LICENSE).
