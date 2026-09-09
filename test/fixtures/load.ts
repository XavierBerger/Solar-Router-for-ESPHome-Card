/**
 * Loading, and bending, the device fixtures.
 *
 * The fixtures under `test/fixtures/*.json` are generated from the firmware's
 * own `esphome config` output, so the entity names in them are the ones a real
 * router publishes rather than names we imagined. The derivations below build
 * the awkward cases out of those: a device that is offline, one still booting,
 * one running firmware from before the version sensors.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { DeviceEntity } from "../../src/detect/registry";

export interface FixtureEntity {
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

export interface Fixture {
  device: { id: string; name: string; sw_version: string };
  entities: FixtureEntity[];
}

export function loadFixture(name: string): Fixture {
  const path = fileURLToPath(new URL(`./${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

/** The registry view, which is all that detection needs to find packages. */
export function toEntities(fixture: Fixture): DeviceEntity[] {
  return fixture.entities
    .filter((entity) => !entity.disabled_by)
    .map((entity) => ({
      entityId: entity.entity_id,
      domain: entity.domain,
      originalName: entity.original_name,
      entityCategory: entity.entity_category,
    }));
}

/** The state view, which is where the versions live. */
export function toStates(fixture: Fixture): Record<string, { state: string }> {
  const states: Record<string, { state: string }> = {};
  for (const entity of fixture.entities) {
    states[entity.entity_id] = { state: entity.state };
  }
  return states;
}

/** True for the version sensor of a package. */
function isVersionEntity(entity: FixtureEntity): boolean {
  return entity.attributes["icon"] === "mdi:tag-outline";
}

/** A device running firmware from before the version sensors existed. */
export function withoutVersionSensors(fixture: Fixture): Fixture {
  return { ...fixture, entities: fixture.entities.filter((e) => !isVersionEntity(e)) };
}

/** A device that booted seconds ago: the sensors exist, none has published. */
export function withVersionsUnpublished(fixture: Fixture): Fixture {
  return {
    ...fixture,
    entities: fixture.entities.map((e) => (isVersionEntity(e) ? { ...e, state: "unknown" } : e)),
  };
}

/** A device that is offline. */
export function offline(fixture: Fixture): Fixture {
  return { ...fixture, entities: fixture.entities.map((e) => ({ ...e, state: "unavailable" })) };
}

/** The user disabled the diagnostic entities in Home Assistant. */
export function withVersionsDisabled(fixture: Fixture): Fixture {
  return {
    ...fixture,
    entities: fixture.entities.map((e) => (isVersionEntity(e) ? { ...e, disabled_by: "user" } : e)),
  };
}

/** Rename an entity the way a user does, leaving `original_name` alone. */
export function renamed(fixture: Fixture, originalName: string, to: string): Fixture {
  return {
    ...fixture,
    entities: fixture.entities.map((e) =>
      e.original_name === originalName ? { ...e, name: to } : e,
    ),
  };
}

/** Hide an entity the way a user does. It stays in the registry. */
export function hidden(fixture: Fixture, originalName: string): Fixture {
  return {
    ...fixture,
    entities: fixture.entities.map((e) =>
      e.original_name === originalName ? { ...e, hidden_by: "user" } : e,
    ),
  };
}

/** Add an entity, for the cases no real config produces. */
export function plus(fixture: Fixture, entity: Partial<FixtureEntity>): Fixture {
  const base: FixtureEntity = {
    entity_id: "sensor.made_up",
    domain: "sensor",
    original_name: null,
    name: null,
    entity_category: null,
    disabled_by: null,
    hidden_by: null,
    state: "unknown",
    attributes: {},
  };
  return { ...fixture, entities: [...fixture.entities, { ...base, ...entity }] };
}

/** A version sensor for `packageName`, as the firmware would publish it. */
export function versionEntity(packageName: string, version: string): Partial<FixtureEntity> {
  return {
    entity_id: `sensor.made_up_${packageName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    domain: "sensor",
    original_name: packageName,
    entity_category: "diagnostic",
    state: version,
    attributes: { icon: "mdi:tag-outline" },
  };
}
