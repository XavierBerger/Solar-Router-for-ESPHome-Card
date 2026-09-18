#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Working directory: ${SCRIPT_DIR}"
cd "${SCRIPT_DIR}"

echo "==> Building Fronius simulator..."
docker compose build fronius-simulator

echo "==> Restarting Fronius simulator..."
docker compose up -d --no-deps fronius-simulator

echo "==> Checking container status..."
docker compose ps fronius-simulator

echo
echo "==> Fronius simulator updated successfully."
echo "    API: http://fronius-simulator:8080"
echo
echo "    Logs:"
echo "    docker compose logs -f fronius-simulator"
