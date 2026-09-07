# AGENTS.md

This file provides guidance AI agents when working with code in this repository.

## What this repository is

**Solar Router Card** is a single Home Assistant Lovelace custom card, written in TypeScript + Lit and
distributed through HACS as a *plugin*. It is the companion of
[hacf-fr/Solar-Router-for-ESPHome](https://github.com/hacf-fr/Solar-Router-for-ESPHome), a library of
composable ESPHome YAML packages for DIY solar-surplus diverters.

The problem it solves: a solar router is assembled from packages — one power meter + one engine + one
or more regulators, plus optional energy counter, temperature limiter, fan control and schedulers. The
ESPHome integration therefore exposes a *different set of entities on every device*, and users end up
hand-building a dashboard out of some thirty raw entities.

The card takes one `device_id`, **works out which modules that device was built from by looking at its
entities**, and renders exactly the matching controls: live status on top, controls grouped by module
in the middle, and an **Advanced** section collapsed at the bottom for fine tuning and diagnostics.

The roadmap, the full detection table and the UX layout live in [`plan/PLAN.md`](plan/PLAN.md). Read it
before starting work — this file is the engineering contract, that one is the design.

## Architecture decisions (settled)

| Decision                                                   | Why it is the right one                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No backend.** Everything goes through the `hass` object. | A card already has the entity states, the device and entity registries, and `callService`. Staying frontend-only means nothing to install server-side, HACS updates are a single file, and there is no version coupling between card and integration.                                                    |
| **TypeScript + Lit**                                       | Gives direct access to Home Assistant's own components — `ha-form`, `ha-control-slider`, `ha-selector`, the device picker — so the card inherits HA's theming, accessibility and translations for free, and the GUI editor is a few lines. It is also the stack every HA card contributor already knows. |
| **One polymorphic card**                                   | One entry in the card picker, one configuration to learn, one page of documentation. The adaptivity lives in the code rather than in the user's YAML.                                                                                                                                                    |
| **Runtime detection by entity introspection**              | Works with every router already flashed — no package `refresh`, no reflash, no firmware change. A user installs the card and it simply recognises their setup.                                                                                                                                           |
| **English + French**                                       | Matches the bilingual documentation of the firmware project and the francophone community around it.                                                                                                                                                                                                     |
| **GPL-3.0**                                                | Same licence as the firmware repository. Every npm dependency must be GPL-compatible.                                                                                                                                                                                                                    |

## The detection contract

`AGENTS.md` in the firmware repository declares both the ESPHome `id:` **and** the `name:` of every
package entity to be public API. The card is built on that promise, which is what makes introspection
reliable rather than a guess.

**Match on `(domain, original_name)` — never on the entity id alone, and never on the name alone.**

- `original_name` (from `config/entity_registry/list`) is the ESPHome `name:` verbatim
  (`"Activate Solar Routing"`, `"Target grid exchange"`, `"Safety limit reached"`…). It survives the
  user renaming the entity id or the friendly name, which people do routinely.
- It is also the only handle for the entities the firmware declares without an `id:` — `Restart`,
  `Uptime Sensor`, `Safety limit reached`, `Used for cooling`, and everything in `debug_sensors.yaml`.
- The domain is part of the key because a few names are intentionally reused across domains.

Resolution order: filter `hass.entities` by `device_id` → look up `original_name` in the cached entity
registry → fall back to the slugified entity-id suffix only when `original_name` is empty.

The role→entity table lives in `src/detect/catalog.ts` and is the single source of truth. Keep entity
names there; do not scatter them across components.

### Rules that follow from the firmware

These are properties of the shipped packages. Encoding them in the catalog is what makes the card work
on real installations rather than only on the happy path.

1. **Degrade gracefully.** Every role is optional. A missing entity is never an error and never an
   empty section — the section simply does not render.
2. `hide_regulators` and `hide_leds` default to `"True"`, so the *same engine* can present three
   different entity sets. The absence of `Regulator Opening` tells you nothing about the engine.
3. `Regulator Opening` **changes domain**: a `number` in `engine_1dimmer`, a `sensor` in the three
   other dimmer engines. Look it up in both, and render it editable or read-only accordingly — this is
   a feature, since the dimmer engine genuinely lets you drive the regulator by hand.
4. Some names are shared across domains: `Start tempo` and `Stop tempo` exist as both `number` and
   `sensor` (setpoint and live countdown), as does `Bypass tempo` (`full_power_duration` vs
   `bypass_tempo_counter`). Pair them up in the UI — the setpoint and its countdown belong together.
5. `Energy divertion Realy 3 Bypass` contains a typo, and that typo is part of the public API. Match
   it as it is; fixing it upstream would break every existing installation.
6. Units vary between packages — `"w"` lowercase on `stop_power_level`, an empty
   `unit_of_measurement` on the reactivities, `device_class: duration` with no unit on
   `Relay N Countdown`. The card supplies its own unit label per role, which also lets it present
   consistent, translated units.
7. `safety_temperature` is the only entity whose name is not title-cased.
8. `Used for cooling` compiles to `ALWAYS_OFF`, so it returns to off after a reboot. Surface that in
   the UI so the behaviour is understood rather than discovered.
9. `em3_phase_a/b/c_power` are **visible** by default (`show_phase_power` feeds `internal:` directly,
   so `"False"` means shown). Expect them, and put them in diagnostics.
10. Schedulers are multi-instance by design. Enumerate them with `^(.*) Scheduler Router Level$` and
    render one collapsible per instance; never hard-code the default `Forced` label.

### What is deliberately left undetected

The information does not exist on the Home Assistant side, so the card states what it knows and stays
silent on the rest rather than guessing:

- **Which regulator.** `regulator_triac`, `regulator_solid_state_relay` and
  `regulator_mecanical_relay` expose no entity at all. Only the *number* of mechanical relays can be
  inferred, from the `Relay N Countdown` sensors.
- **Dallas vs Home Assistant temperature limiter** — both publish an entity named `safety_temperature`,
  and the controls are identical either way, so nothing is lost.
- **Fronius vs proxy client vs Home Assistant power meter** — all converge on `Real Power` /
  `Consumption`, which is exactly what the card displays.

If exact identification becomes valuable, the clean fix is upstream (`esphome: project:` in
`common.yaml`), not a cleverer heuristic here.

## Home Assistant integration rules

These are what make a card behave correctly once it is installed by real users:

- Render **inside the element's shadow root**. Lit does this natively; keep the Playwright test that
  asserts it, so the guarantee stays enforced.
- Home Assistant serves `/local/` with a one-month cache, so keep an incrementable `?v=` on the
  Lovelace resource URL during development to see your changes immediately.
- Keep the built filename **stable** (no content hash): the Lovelace resource URL the user configured
  must keep working across upgrades.
- Serve the card from `/local/` during development. It is same-origin, exactly like a HACS install, so
  what you test is what users get.
- Treat "renders in a dev page" and "works inside Home Assistant" as two distinct claims, and verify
  both. See the test levels below.

## Testing

Four levels. State plainly which ones you ran, and never report a level you skipped.

1. **Unit** — `npm test` (Vitest). Detection against the fixtures in `test/fixtures/`, one per real
   module combination taken from the firmware repository's root configs, plus an offline
   (`unavailable`) device. Negative cases are part of the suite: `Regulator Opening` as sensor vs
   number, the `Start tempo` number/sensor pair, a proxy device with no engine, a non-router device.
2. **Render** — Vitest + `@open-wc/testing-helpers`: mount with each fixture, assert that irrelevant
   sections are absent and that a missing entity never throws.
3. **Browser under Home Assistant** — `dev/dev-up.sh`, then Playwright against
   `http://localhost:8123`. The dev instance has no physical router, so the dashboard uses the demo
   build (`demo: <fixture>`) — a **separate entry point**, so fixtures never reach the production
   bundle.
4. **Real hardware** — build into the maintainer's `/config/www`, one card per physical router. This
   is the level that validates `Used for cooling`, the LEDs and the relays end to end.

## Conventions

- Theme through Home Assistant CSS variables only (`--ha-card-background`, `--primary-text-color`,
  `--primary-color`, `--error-color`…). No hard-coded colours, so light, dark and custom themes all
  look right.
- No charting or graphics dependency — the gauge is inline SVG.
- Responsive down to a single column below 450 px.
- Render `unavailable` / `unknown` explicitly; a silent `—` hides a router that needs attention.
- Register in `window.customCards` so the card appears in the picker, and implement `getCardSize()`.
- Keep the production bundle small (target < 120 kB minified) and verify `dist/` contains no fixture.
- Conventional-commit messages and PR titles, matching the firmware repository.

## Related repository

`hacf-fr/Solar-Router-for-ESPHome` — the ESPHome packages. Its `AGENTS.md` holds the cross-package id
contract this card depends on. User-facing documentation for the card belongs there, as
`docs/en/card.md` + `docs/fr/card.md` plus a `nav:` entry, because the mkdocs site is bilingual and
kept file-for-file symmetric.
