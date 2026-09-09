#!/usr/bin/env bash
# Build the card straight into the development Home Assistant's /local/ tree.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
target="$here/homeassistant/config/www/solar-router"

cd "$root"
# BUILD_DEMO also emits dist/solar-router-demo.js, which carries the fixtures so
# the dashboard can show every state without a router on the network. It is a
# separate Rollup entry, so the production bundle stays free of them.
BUILD_DEMO=true npm run --silent build

mkdir -p "$target"
cp dist/solar-router-card.js "$target/solar-router-card.js"
cp dist/solar-router-demo.js "$target/solar-router-demo.js"

echo "Card: $(wc -c < "$target/solar-router-card.js") bytes  -> /local/solar-router/solar-router-card.js"
echo "Demo: $(wc -c < "$target/solar-router-demo.js") bytes  -> /local/solar-router/solar-router-demo.js"
