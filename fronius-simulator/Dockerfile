FROM rust:1.96-slim AS build

WORKDIR /app
COPY fronius-simulator/Cargo.toml ./Cargo.toml
COPY fronius-simulator/Cargo.lock ./Cargo.lock
COPY fronius-simulator/src ./src
RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN useradd --create-home --shell /usr/sbin/nologin fronius
USER fronius
WORKDIR /home/fronius

COPY --from=build /app/target/release/fronius-simulator /usr/local/bin/fronius-simulator
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/fronius-simulator"]
