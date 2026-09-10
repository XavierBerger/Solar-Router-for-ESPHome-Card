# Solar Router Card

A Home Assistant Lovelace card for [Solar Router for ESPHome](https://github.com/hacf-fr/Solar-Router-for-ESPHome).

A solar router is assembled from ESPHome packages — a power meter, an engine, one or more regulators,
and optionally an energy counter, a temperature limiter, fan control and schedulers. Every router
therefore exposes a different set of entities, and building a dashboard means wiring some thirty of
them by hand.

This card takes one device and works out which modules it was built from, then shows exactly the
matching controls: live status on top, controls grouped by module, and an **Advanced** section for
fine tuning and diagnostics.

It reads your existing routers as they are. No firmware change, no package `refresh`, no reflash.

## Status

Under development. Phase 1 of [`plan/PLAN.md`](plan/PLAN.md): the card builds, installs and renders
inside Home Assistant, and lists the entities it finds on the selected device. Module detection and
the controls come next.

## Installation

### HACS

Not yet published. Until then, add this repository as a custom repository of type *Dashboard*.

### Manual

1. Download `solar-router-card.js` from the latest release.
2. Copy it to `config/www/solar-router/solar-router-card.js`.
3. Add the resource, under *Settings → Dashboards → ⋮ → Resources*:
   `/local/solar-router/solar-router-card.js`, type *JavaScript module*.

## Configuration

```yaml
type: custom:solar-router-card
device_id: 3f8a…            # required — the ESPHome device of your router
name: Water heater          # optional, overrides the title
advanced_open: false        # optional, initial state of the Advanced section
```

| Option          | Type    | Default     | Description                                                             |
| --------------- | ------- | ----------- | ----------------------------------------------------------------------- |
| `device_id`     | string  | —           | Device registry id of the router.                                       |
| `name`          | string  | device name | Card title.                                                             |
| `advanced_open` | boolean | `false`     | Whether the Advanced section starts open.                               |
| `sections`      | map     | `auto`      | Per-section `auto` / `show` / `hide` override.                          |
| `entities`      | map     | `{}`        | Role → `entity_id` override for installations detection cannot resolve. |

## Development

```bash
npm install
npm run build          # dist/solar-router-card.js
npm run dev:up         # build + Home Assistant on http://localhost:8123
npm run dev:build      # rebuild into the dev instance after a change
npm run dev:down       # stop it
```

The development instance serves the card from `/local/`, same-origin, exactly as a HACS install
does. Home Assistant caches `/local/` for a month, so bump `?v=` in
`dev/homeassistant/config/configuration.yaml` when a rebuild does not show up.

Engineering rules are in [`AGENTS.md`](AGENTS.md); the design and roadmap in [`plan/PLAN.md`](plan/PLAN.md).

## Transparency about AI-Assisted Development

This card was developed with the assistance of an AI coding assistant, closely coached and supervised by an experienced developer. Particular attention was given to the software architecture, code quality, maintainability, and test coverage, with the goal of ensuring a robust and well-engineered codebase.

## Licence

GPL-3.0-or-later, like the firmware project.
