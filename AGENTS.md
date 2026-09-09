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
| **Detection from what the firmware declares**              | Every `solar_router/*.yaml` package publishes a version `text_sensor`, so the card reads the router's composition instead of guessing it. Exact where inference was approximate, and it lifts the three blind spots inference could never resolve. The cost is a package `refresh` and a reflash.        |
| **English + French**                                       | Matches the bilingual documentation of the firmware project and the francophone community around it.                                                                                                                                                                                                     |
| **GPL-3.0**                                                | Same licence as the firmware repository. Every npm dependency must be GPL-compatible.                                                                                                                                                                                                                    |

## The detection contract

Two layers, and conflating them is the mistake to avoid:

| | Question | Mechanism |
| --- | --- | --- |
| **Modules** | which packages is this router built from? | **declared** — the firmware says so |
| **Roles** | which entity is `Router Level`? | **`(domain, original_name)`** |

### Modules — the firmware declares its own composition

Every `solar_router/*.yaml` package ends with a template `text_sensor`, `entity_category:
diagnostic`, named after the package, publishing a bare semver. In Home Assistant that is a `sensor`
entity whose `original_name` **is** the package name and whose state is the version. Enumerating them
gives the router's exact composition — no inference, and the version of each package for free.

**Presence comes from the registry, the version comes from the state.** The lambda has a
`static bool published` guard, so the sensor publishes once about ten seconds after boot and then
stays silent: its state is `unknown` until then. Never conclude "old firmware" from a state, only
from the absence of the entity in the registry. The compatibility verdict has four values —
`supported`, `outdated`, `not_a_router`, `unknown` — because a device that has never connected is not
an old router, and refusing to conclude is the right answer.

There is no universal anchor package: `esp8266-proxy-client.yaml` loads no `common.yaml`, and
`power_meter_common` is missing wherever the leaf merges its common with `<<: !include` rather than
`packages:` (`power_meter_home_assistant.yaml`, which deliberately overrides `real_power` and
`consumption`). Test for *at least one* version sensor, never for a particular one, and never warn
about a missing `*_common`.

Match on the name, with the domain as the only filter. `entity_category` and the semver shape are
*validators* worth warning about, never gates — gating on the state is exactly the ten-second false
positive above.

### Roles — `(domain, original_name)`

`AGENTS.md` in the firmware repository declares both the ESPHome `id:` **and** the `name:` of every
package entity to be public API. The card is built on that promise, which is what makes role
resolution reliable rather than a guess.

**Match on `(domain, original_name)` — never on the entity id alone, and never on the name alone.**

- `original_name` (from `config/entity_registry/list`) is the ESPHome `name:` verbatim
  (`"Activate Solar Routing"`, `"Target grid exchange"`, `"Safety limit reached"`…). It survives the
  user renaming the entity id or the friendly name, which people do routinely.
- It is also the only handle for the entities the firmware declares without an `id:` — `Restart`,
  `Uptime Sensor`, `Safety limit reached`, `Used for cooling`, and everything in `debug_sensors.yaml`.
- The domain is part of the key because a few names are intentionally reused across domains.

Resolution order: filter `hass.entities` by `device_id` → look up `original_name` in the cached entity
registry → fall back to the slugified entity-id suffix only when `original_name` is empty.

Two properties of `config/entity_registry/list` make this work, both checked against the Home
Assistant source (2026.9.1) rather than assumed:

- It carries **no `require_admin`** decorator, unlike three other commands in the same module, so a
  non-admin household member sees a working card.
- Its payload includes `original_name`, and Home Assistant returns the *unprefixed* form for entities
  with `has_entity_name` — which every ESPHome entity has. So the value is `"Activate Solar Routing"`,
  the package's `name:` exactly, with no device prefix to strip.

Do not swap it for `config/entity_registry/list_for_display`, which is what backs `hass.entities`: its
compact payload has no `original_name`, and the card would be left guessing from entity ids.

The role→entity table lives in `src/detect/catalog.ts` and the package table in
`src/detect/packages.ts`; each is the single source of truth for its axis. Keep entity and package
names there; do not scatter them across components. Never derive one from the other: the firmware's
`id:` is `version_` + the file name with `-` replaced by `_`, while its `name:` keeps the file name
verbatim — `id: version_energy_counter_jsy_mk_194t` for `name: "energy_counter_jsy-mk-194t"`. Match
names exactly, hyphens and mixed case included (`temperature_limiter_DS18B20`); never slugify them.

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

### The blind spots are gone

Three things used to be undetectable, because the packages involved published nothing that told them
apart. They now name themselves, and the card can say which regulator drives the load, whether the
temperature comes from a local DS18B20 or from Home Assistant, and which of the six power meters
feeds `Real Power`. That is worth more than a label: it is what lets an error message name the
culprit instead of showing a silent dash.

Two traps come with it:

- **Regulators are a list, never a value.** `esp8266-proxy-client.yaml` loads a solid-state relay
  *and* a mechanical one; `esp32-standalone_1dimmer_2switches_1bypass.yaml` a triac *and* three
  mechanical relays.
- **The number of mechanical relays is not the number of `Relay N Countdown` sensors.** Two
  quantities, two fields. `esp8266-proxy-client.yaml` loads a mechanical relay while
  `engine_1dimmer_1bypass` publishes no countdown at all.

What stays out of reach is the identity of the installed release: the sensors give a version *per
package*, and since a release only bumps the packages it touched, `max(versions)` is a lower bound,
never the release. An `esphome: project:` upstream would answer that; the card does not need it.

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
   (`unavailable`) device. Negative cases are part of the suite. On roles: `Regulator Opening` as
   sensor vs number, the `Start tempo` number/sensor pair, `Regulator Opening` absent altogether. On
   packages: `regulator_mecanical_relay_` with an empty instance suffix, three relay instances,
   `temperature_limiter_DS18B20`'s mixed case, `power_meter_common` missing behind a `<<: !include`,
   two `engine_*` packages, a proxy with no engine, and the four compatibility verdicts — including
   the two that must never regress to `outdated`: every state `unavailable`, and every version still
   `unknown` ten seconds after boot.
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
