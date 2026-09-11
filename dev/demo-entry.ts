/**
 * A development build that carries the fixtures with it.
 *
 * The development Home Assistant has no router on it, so without this the only
 * states reachable in a browser are "pick a device" and "not a router". This
 * entry point wraps the real card in a `<solar-router-demo-card>` fed by a fake
 * `hass` built from `test/fixtures/`, which makes every state — every engine,
 * an offline device, one still booting, firmware too old — reachable with no
 * hardware at all.
 *
 * It is a **separate Rollup entry** on purpose: the fixtures must never reach
 * the production bundle. `dist/solar-router-card.js` is built from
 * `src/solar-router-card.ts` alone and contains none of this.
 *
 * Nothing under `src/` is imported here, only its types. The card comes from
 * the production bundle, loaded as the previous Lovelace resource, so what the
 * dashboard exercises is the very file a user installs. Importing it instead
 * would bundle a second copy: a duplicate `customElements.define` — Home
 * Assistant reports it and the card never renders — and a second, unrelated
 * copy of the module-level registry cache.
 */

import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { HomeAssistant } from "../src/types/home-assistant";

import engine1dimmer1bypass from "../test/fixtures/engine_1dimmer_1bypass.json";
import engine1dimmer2switches from "../test/fixtures/engine_1dimmer_2switches.json";
import engine1dimmer2switches1bypass from "../test/fixtures/engine_1dimmer_2switches_1bypass.json";
import engine1dimmerDs18b20 from "../test/fixtures/engine_1dimmer_ds18b20_counter.json";
import engine1dimmerEm3 from "../test/fixtures/engine_1dimmer_em3.json";
import engine1dimmerFan from "../test/fixtures/engine_1dimmer_fan.json";
import engine1dimmerFronius from "../test/fixtures/engine_1dimmer_fronius.json";
import engine1dimmerJsy from "../test/fixtures/engine_1dimmer_jsy_debug.json";
import engine1dimmerScheduler from "../test/fixtures/engine_1dimmer_scheduler.json";
import engine1switchHa from "../test/fixtures/engine_1switch_ha_limiter.json";
import proxyOnly from "../test/fixtures/proxy_only.json";

interface FixtureEntity {
  entity_id: string;
  domain: string;
  original_name: string | null;
  name: string | null;
  entity_category: "config" | "diagnostic" | null;
  disabled_by: string | null;
  hidden_by: string | null;
  state: string;
  attributes: Record<string, unknown>;
}

interface Fixture {
  device: { id: string; name: string; sw_version: string };
  entities: FixtureEntity[];
}

const BASE: Record<string, Fixture> = {
  engine_1dimmer_fronius: engine1dimmerFronius as Fixture,
  engine_1dimmer_2switches: engine1dimmer2switches as Fixture,
  engine_1dimmer_2switches_1bypass: engine1dimmer2switches1bypass as Fixture,
  engine_1dimmer_1bypass: engine1dimmer1bypass as Fixture,
  engine_1switch_ha_limiter: engine1switchHa as Fixture,
  engine_1dimmer_ds18b20_counter: engine1dimmerDs18b20 as Fixture,
  engine_1dimmer_scheduler: engine1dimmerScheduler as Fixture,
  engine_1dimmer_em3: engine1dimmerEm3 as Fixture,
  engine_1dimmer_jsy_debug: engine1dimmerJsy as Fixture,
  engine_1dimmer_fan: engine1dimmerFan as Fixture,
  proxy_only: proxyOnly as Fixture,
};

const isVersion = (entity: FixtureEntity) => entity.attributes["icon"] === "mdi:tag-outline";

/** Rebuild a fixture under a new id, so several can coexist on one dashboard. */
function derive(
  source: Fixture,
  id: string,
  map: (e: FixtureEntity) => FixtureEntity | null,
): Fixture {
  return {
    device: { ...source.device, id, name: `${source.device.name} (${id})` },
    entities: source.entities
      .map((entity) => map({ ...entity, entity_id: entity.entity_id.replace(".", `.${id}_`) }))
      .filter((entity): entity is FixtureEntity => entity !== null),
  };
}

const ROUTER = BASE.engine_1dimmer_fronius;

/**
 * Plausible live values.
 *
 * `esphome config` describes entities but never their states, so every fixture
 * arrives with its business entities at `unknown` — which is right for the
 * detection tests and useless for looking at the live band. These are sample
 * readings, chosen to exercise the interesting paths: a router exporting to the
 * grid while diverting, rather than a row of dashes.
 */
const LIVE: Record<string, string> = {
  "Activate Solar Routing": "on",
  "Real Power": "-1240",
  Consumption: "1700",
  "Router Level": "68",
  "Power divertion": "1240",
  "Total energy diverted": "4.21",
  "Total daily energy diverted": "4.21",
  "Target grid exchange": "0",
  safety_temperature: "54",
  "Safety limit reached": "off",
  "Stop temperature": "60",
  "Restart temperature": "50",
  "Used for cooling": "off",
  "Load power": "2000",
  "Start power level": "100",
  "Stop power level": "50",
  "Start tempo": "5",
  "Stop tempo": "5",
  "Bypass tempo": "30",
  "Temperature to start fan": "45",
  "Temperature to stop fan": "40",
  "Up Reactivity": "1",
  "Down Reactivity": "1",
  "Regulator Opening": "68",
};

/** Scheduler entity names carry their instance id, so they match by shape. */
const LIVE_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/^Activate .* Scheduler$/, "off"],
  [/Scheduler Router Level$/, "80"],
  [/Scheduler Checking End Threshold$/, "0"],
  [/Scheduler Begin Hour$/, "9"],
  [/Scheduler Begin Minute$/, "0"],
  [/Scheduler End Hour$/, "17"],
  [/Scheduler End Minute$/, "0"],
  [/Countdown$/, "0"],
];

function liven(entity: FixtureEntity): FixtureEntity {
  if (isVersion(entity)) {
    return entity;
  }
  const name = entity.original_name ?? "";
  const sample =
    LIVE[name] ?? LIVE_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? undefined;
  return sample === undefined ? entity : { ...entity, state: sample };
}

/** The states no real config produces, derived the way the unit tests do. */
const DERIVED: Record<string, Fixture> = {
  legacy_no_versions: derive(ROUTER, "legacy_no_versions", (e) => (isVersion(e) ? null : e)),
  booting: derive(ROUTER, "booting", (e) => (isVersion(e) ? { ...e, state: "unknown" } : e)),
  offline: derive(ROUTER, "offline", (e) => ({ ...e, state: "unavailable" })),
  versions_disabled: derive(ROUTER, "versions_disabled", (e) =>
    isVersion(e) ? { ...e, disabled_by: "user" } : e,
  ),
};

const SAFETY: Fixture = derive(BASE.engine_1dimmer_ds18b20_counter, "safety_tripped", (e) =>
  e.original_name === "Safety limit reached"
    ? { ...liven(e), state: "on" }
    : e.original_name === "safety_temperature"
      ? { ...liven(e), state: "62" }
      : liven(e),
);

const SCHEDULED: Fixture = derive(BASE.engine_1dimmer_scheduler, "scheduler_open", (e) => {
  const name = e.original_name ?? "";
  if (/Scheduler$/.test(name)) {
    return { ...liven(e), state: "on" };
  }
  if (/Begin Hour$|Begin Minute$/.test(name)) {
    return { ...liven(e), state: "0" };
  }
  if (/End Hour$/.test(name)) {
    return { ...liven(e), state: "23" };
  }
  if (/End Minute$/.test(name)) {
    return { ...liven(e), state: "59" };
  }
  return liven(e);
});

const FIXTURES: Record<string, Fixture> = {
  ...Object.fromEntries(
    Object.entries(BASE).map(([name, fixture]) => [
      name,
      { ...fixture, entities: fixture.entities.map(liven) },
    ]),
  ),
  ...DERIVED,
  safety_tripped: SAFETY,
  scheduler_open: SCHEDULED,
};

/**
 * One fake `hass` holding every fixture at once.
 *
 * Home Assistant has a single entity registry covering many devices, and the
 * card caches it once per page — so merging the fixtures into one registry is
 * both realistic and the only way several demo cards can share a dashboard
 * without fighting over that cache.
 */
function buildHass(language: string): HomeAssistant {
  const states: HomeAssistant["states"] = {};
  const devices: HomeAssistant["devices"] = {};
  const entities: HomeAssistant["entities"] = {};
  const registry: unknown[] = [];

  for (const fixture of Object.values(FIXTURES)) {
    devices[fixture.device.id] = {
      id: fixture.device.id,
      name: fixture.device.name,
      name_by_user: null,
      manufacturer: "espressif",
      model: null,
      sw_version: fixture.device.sw_version,
    };
    for (const entity of fixture.entities) {
      states[entity.entity_id] = {
        entity_id: entity.entity_id,
        state: entity.state,
        attributes: {
          friendly_name: entity.original_name ?? entity.entity_id,
          ...entity.attributes,
        },
        last_changed: "",
        last_updated: "",
      };
      entities[entity.entity_id] = {
        entity_id: entity.entity_id,
        device_id: fixture.device.id,
        entity_category: entity.entity_category ?? undefined,
      };
      registry.push({
        entity_id: entity.entity_id,
        device_id: fixture.device.id,
        platform: "esphome",
        unique_id: entity.entity_id,
        name: entity.name,
        original_name: entity.original_name,
        entity_category: entity.entity_category,
        disabled_by: entity.disabled_by,
        hidden_by: entity.hidden_by,
      });
    }
  }

  return {
    states,
    devices,
    entities,
    language,
    callService: async () => undefined,
    callWS: async <T>() => registry as T,
  } as HomeAssistant;
}

/** One fake `hass` per language, so a dashboard can show both side by side. */
const shared: Record<string, HomeAssistant> = {};

function hassFor(language: string): HomeAssistant {
  shared[language] ??= buildHass(language);
  return shared[language];
}

@customElement("solar-router-demo-card")
export class SolarRouterDemoCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _fixture = "";

  @state() private _language = "en";

  public setConfig(config: { demo?: string; lang?: string }): void {
    const name = config.demo ?? "";
    if (name && !FIXTURES[name]) {
      throw new Error(
        `Unknown demo fixture "${name}". Try one of: ${Object.keys(FIXTURES).join(", ")}`,
      );
    }
    this._fixture = name;
    this._language = config.lang ?? "en";
  }

  public getCardSize(): number {
    return 8;
  }

  protected override render(): TemplateResult {
    return html`<solar-router-card .hass=${hassFor(this._language)}></solar-router-card>`;
  }

  /**
   * A Lovelace card is configured through a method, not a property, so the
   * inner card has to be configured once it exists rather than in the template.
   */
  protected override updated(): void {
    // The card element may not be upgraded yet if the browser is still
    // fetching the production bundle, so wait for it rather than racing it.
    void customElements.whenDefined("solar-router-card").then(() => {
      const card = this.renderRoot.querySelector("solar-router-card") as
        (HTMLElement & { setConfig?: (config: unknown) => void; _demoKey?: string }) | null;
      const key = `${this._fixture}/${this._language}`;
      if (!card?.setConfig || card._demoKey === key) {
        return;
      }
      card._demoKey = key;
      card.setConfig({
        device_id: FIXTURES[this._fixture]?.device.id ?? "",
        name: this._fixture,
      });
    });
  }
}

/**
 * The GUI editor, mounted directly.
 *
 * The development dashboard runs in YAML mode, where Home Assistant never opens
 * a card's editor, so this is the only way to see it without first creating a
 * storage-mode dashboard by hand. It exercises the editor's own rendering; the
 * round trip through Home Assistant's configuration dialog still needs a real
 * dashboard.
 */
@customElement("solar-router-demo-editor")
export class SolarRouterDemoEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _fixture = "";
  @state() private _language = "en";

  public setConfig(config: { demo?: string; lang?: string }): void {
    const name = config.demo ?? "";
    if (name && !FIXTURES[name]) {
      throw new Error(
        `Unknown demo fixture "${name}". Try one of: ${Object.keys(FIXTURES).join(", ")}`,
      );
    }
    this._fixture = name;
    this._language = config.lang ?? "en";
  }

  public getCardSize(): number {
    return 6;
  }

  protected override render(): TemplateResult {
    return html`
      <ha-card .header=${`Editor — ${this._fixture} (${this._language})`}>
        <div style="padding: 0 16px 16px">
          <solar-router-card-editor .hass=${hassFor(this._language)}></solar-router-card-editor>
        </div>
      </ha-card>
    `;
  }

  protected override updated(): void {
    void customElements.whenDefined("solar-router-card-editor").then(() => {
      const editor = this.renderRoot.querySelector("solar-router-card-editor") as
        (HTMLElement & { setConfig?: (config: unknown) => void; _demoKey?: string }) | null;
      const key = `${this._fixture}/${this._language}`;
      if (!editor?.setConfig || editor._demoKey === key) {
        return;
      }
      editor._demoKey = key;
      editor.setConfig({
        type: "custom:solar-router-card",
        device_id: FIXTURES[this._fixture]?.device.id ?? "",
      });
    });
  }
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "solar-router-demo-editor",
  name: "Solar Router Card editor (demo)",
  description: "Mounts the GUI editor against a bundled fixture. Development builds only.",
  preview: false,
});
window.customCards.push({
  type: "solar-router-demo-card",
  name: "Solar Router Card (demo)",
  description: "Renders the card against a bundled fixture. Development builds only.",
  preview: false,
});

console.info(
  `%c solar-router-demo %c ${Object.keys(FIXTURES).length} fixtures `,
  "color: white; background: #8e24aa; font-weight: 700;",
  "color: #8e24aa; background: white; font-weight: 700;",
);
