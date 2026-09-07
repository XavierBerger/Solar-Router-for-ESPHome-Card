#!/usr/bin/env bash
# Build the card and start the development Home Assistant.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=dev/compose.sh
source "$here/compose.sh"

"$here/build-card.sh"

cd "$here"
compose -f docker-compose.yml up -d

cat <<'MSG'

Home Assistant: http://localhost:8123
  First run only: create the account through onboarding.
  Then open the "Solar Router Card Dev" dashboard.

Rebuild after a change:  npm run dev:build
Stop:                    npm run dev:down
MSG
