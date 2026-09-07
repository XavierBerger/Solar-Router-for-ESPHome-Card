#!/usr/bin/env bash
# Build the card straight into the development Home Assistant's /local/ tree.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
target="$here/homeassistant/config/www/solar-router"

cd "$root"
npm run --silent build

mkdir -p "$target"
cp dist/solar-router-card.js "$target/solar-router-card.js"

echo "Built $(wc -c < "$target/solar-router-card.js") bytes"
echo "Lovelace resource: /local/solar-router/solar-router-card.js"
