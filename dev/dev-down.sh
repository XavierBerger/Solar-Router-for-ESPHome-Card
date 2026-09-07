#!/usr/bin/env bash
# Stop the development Home Assistant. Pass --volumes to also drop its state.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=dev/compose.sh
source "$here/compose.sh"

cd "$here"
if [[ "${1:-}" == "--volumes" ]]; then
  compose -f docker-compose.yml down -v
else
  compose -f docker-compose.yml down
fi
