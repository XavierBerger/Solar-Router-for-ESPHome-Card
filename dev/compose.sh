#!/usr/bin/env bash
# Resolve a working Compose command. Docker Desktop, the docker-compose plugin
# and podman-compose are all in use among contributors, so detect rather than
# assume.
set -euo pipefail

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v podman-compose >/dev/null 2>&1; then
    podman-compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "No Compose implementation found (tried docker compose, podman-compose, docker-compose)." >&2
    exit 1
  fi
}
