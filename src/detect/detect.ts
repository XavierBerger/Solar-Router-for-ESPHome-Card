/**
 * From a device's entities to a `RouterProfile`.
 *
 * The algorithm is deliberately dull: it asks the catalog for each role, then
 * reads the signature tables. Everything specific to the firmware lives in
 * `catalog.ts`, so a new package is a data change, not a code change.
 *
 * The function is pure — it takes the entity list, not `hass` — which is what
 * makes the fixtures of `test/fixtures/` enough to test it.
 */

import {
  CATALOG,
  ENGINE_SIGNATURES,
  MODULE_ORDER,
  MODULE_SIGNATURES,
  SCHEDULER_ANCHOR,
  SCHEDULER_CATALOG,
  schedulerEntityName,
} from "./catalog";
import type { DeviceEntity } from "./registry";
import {
  isWritableDomain,
  type DetectionWarning,
  type DeviceKind,
  type Domain,
  type EngineId,
  type ModuleId,
  type ResolvedRole,
  type Role,
  type RouterProfile,
  type SchedulerInstance,
  type SchedulerRole,
} from "./types";

export interface DetectOptions {
  /**
   * The card's `entities:` option — role → entity_id, pinned by the user for
   * an installation detection cannot resolve on its own. An override always
   * wins over what was detected.
   */
  readonly overrides?: Readonly<Record<string, string>>;
}

/**
 * ESPHome's slugification, applied to a `name:` to get the tail of the entity
 * id it generates.
 *
 * Only used for the fallback below: `original_name` is the contract, this is
 * the safety net.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function objectId(entityId: string): string {
  return entityId.slice(entityId.indexOf(".") + 1);
}

function domainOf(entityId: string): string {
  const dot = entityId.indexOf(".");
  return dot === -1 ? "" : entityId.slice(0, dot);
}

interface EntityIndex {
  /** `(domain, original_name)` → entity. The contract, and the fast path. */
  readonly byName: Map<string, DeviceEntity>;
  readonly byDomain: Map<string, DeviceEntity[]>;
  /**
   * The `<device>_` head shared by the object ids of this device, so the
   * fallback can strip it. Empty when there is nothing to learn from.
   */
  readonly idPrefix: string;
}

function nameKey(domain: string, name: string): string {
  return `${domain}.${name}`;
}

/**
 * The `<device>_` head the ESPHome integration puts on every object id of a
 * device, taken as the longest common prefix cut at an underscore.
 *
 * Used only to recover a scheduler's `scheduler_unique_id` from an object id
 * when the registry has no `original_name` to read it from.
 */
function commonIdPrefix(entities: readonly DeviceEntity[]): string {
  const ids = entities.map((entity) => objectId(entity.entityId));
  if (ids.length < 2) {
    return "";
  }
  let prefix = ids[0];
  for (const id of ids.slice(1)) {
    let shared = 0;
    while (shared < prefix.length && shared < id.length && prefix[shared] === id[shared]) {
      shared += 1;
    }
    prefix = prefix.slice(0, shared);
    if (prefix === "") {
      return "";
    }
  }
  const cut = prefix.lastIndexOf("_");
  return cut === -1 ? "" : prefix.slice(0, cut + 1);
}

function indexEntities(entities: readonly DeviceEntity[]): EntityIndex {
  const byName = new Map<string, DeviceEntity>();
  const byDomain = new Map<string, DeviceEntity[]>();

  for (const entity of entities) {
    const name = entity.originalName?.trim();
    if (name) {
      // First one wins: a device does not publish the same (domain, name)
      // twice, and if it somehow did, the first is as good a choice as any.
      const key = nameKey(entity.domain, name);
      if (!byName.has(key)) {
        byName.set(key, entity);
      }
    }
    const sameDomain = byDomain.get(entity.domain);
    if (sameDomain) {
      sameDomain.push(entity);
    } else {
      byDomain.set(entity.domain, [entity]);
    }
  }

  return { byName, byDomain, idPrefix: commonIdPrefix(entities) };
}

/** True when `entityId` looks like the entity ESPHome generates for `slug`. */
function idMatchesSlug(entityId: string, slug: string): boolean {
  const id = objectId(entityId);
  return id === slug || id.endsWith(`_${slug}`);
}

/**
 * Resolve one role: every candidate domain by name first, then — and only for
 * entities the registry left unnamed — every candidate domain by slug.
 *
 * Doing the name pass across all domains before any slug pass matters for
 * `Regulator Opening`: a `sensor` named exactly must beat a `number` that only
 * matches by slug.
 */
function resolve(
  index: EntityIndex,
  domains: readonly Domain[],
  name: string,
): ResolvedRole | undefined {
  for (const domain of domains) {
    const named = index.byName.get(nameKey(domain, name));
    if (named) {
      return {
        entityId: named.entityId,
        domain,
        writable: isWritableDomain(domain),
        source: "original_name",
      };
    }
  }

  const slug = slugify(name);
  for (const domain of domains) {
    const unnamed = (index.byDomain.get(domain) ?? []).find(
      (entity) => !entity.originalName?.trim() && idMatchesSlug(entity.entityId, slug),
    );
    if (unnamed) {
      return {
        entityId: unnamed.entityId,
        domain,
        writable: isWritableDomain(domain),
        source: "entity_id",
      };
    }
  }

  return undefined;
}

/**
 * List the scheduler instances of a device.
 *
 * `scheduler_unique_id` is a substitution whose default is `Forced`, and the
 * firmware documents loading the package several times (`day` / `night`), so
 * instances are enumerated from the entities and never assumed.
 */
function detectSchedulers(index: EntityIndex): SchedulerInstance[] {
  const ids: string[] = [];

  for (const entity of index.byDomain.get(SCHEDULER_ANCHOR.domain) ?? []) {
    const name = entity.originalName?.trim();
    if (name) {
      const matched = SCHEDULER_ANCHOR.namePattern.exec(name);
      if (matched) {
        ids.push(matched[1]);
      }
      continue;
    }
    // Unnamed in the registry: recover the id from the object id, after
    // dropping the device head. The id comes back slugified, which is all the
    // information there is in that case.
    const id = objectId(entity.entityId);
    const tail = id.startsWith(index.idPrefix) ? id.slice(index.idPrefix.length) : id;
    const matched = SCHEDULER_ANCHOR.slugPattern.exec(tail);
    if (matched) {
      ids.push(matched[1]);
    }
  }

  return [...new Set(ids)]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const roles: Partial<Record<SchedulerRole, ResolvedRole>> = {};
      for (const role of Object.keys(SCHEDULER_CATALOG) as SchedulerRole[]) {
        const found = resolve(
          index,
          SCHEDULER_CATALOG[role].domains,
          schedulerEntityName(role, id),
        );
        if (found) {
          roles[role] = found;
        }
      }
      return { id, roles };
    });
}

function detectEngine(roles: Partial<Record<Role, ResolvedRole>>): EngineId | null {
  for (const signature of ENGINE_SIGNATURES) {
    if (signature.allOf.every((role) => roles[role])) {
      return signature.engine;
    }
  }
  return null;
}

function detectModules(
  roles: Partial<Record<Role, ResolvedRole>>,
  engine: EngineId | null,
  schedulers: readonly SchedulerInstance[],
): ModuleId[] {
  const found = new Set<ModuleId>();

  for (const signature of MODULE_SIGNATURES) {
    const allOf = signature.allOf?.every((role) => roles[role]) ?? true;
    const anyOf = signature.anyOf?.some((role) => roles[role]) ?? true;
    if (allOf && anyOf) {
      found.add(signature.module);
    }
  }
  if (engine) {
    found.add(engine);
  }
  if (schedulers.length > 0) {
    found.add("scheduler_forced_run");
  }

  return MODULE_ORDER.filter((module) => found.has(module));
}

export function detectRouter(
  deviceId: string,
  entities: readonly DeviceEntity[],
  options: DetectOptions = {},
): RouterProfile {
  const index = indexEntities(entities);
  const roles: Partial<Record<Role, ResolvedRole>> = {};
  const warnings: DetectionWarning[] = [];

  for (const role of Object.keys(CATALOG) as Role[]) {
    const definition = CATALOG[role];
    const found = resolve(index, definition.domains, definition.name);
    if (found) {
      roles[role] = found;
    }
  }

  const onDevice = new Set(entities.map((entity) => entity.entityId));
  for (const [key, entityId] of Object.entries(options.overrides ?? {})) {
    if (!entityId) {
      // An editor field the user cleared, not an instruction.
      continue;
    }
    if (!(key in CATALOG)) {
      warnings.push({ code: "override_unknown_role", key });
      continue;
    }
    const domain = domainOf(entityId);
    roles[key as Role] = {
      entityId,
      domain,
      writable: isWritableDomain(domain),
      source: "override",
    };
    if (!onDevice.has(entityId)) {
      warnings.push({ code: "override_off_device", role: key, entityId });
    }
  }

  // What the device is comes before which engine it runs: a power meter proxy
  // publishes `Real Power` and no engine at all, and gets a reduced card
  // rather than an error.
  const kind: DeviceKind = roles.activate ? "router" : roles.real_power ? "power_meter" : "unknown";

  const engine = kind === "router" ? detectEngine(roles) : null;
  if (kind === "router" && !engine) {
    warnings.push({ code: "engine_unknown" });
  }

  const schedulers = detectSchedulers(index);
  const modules = detectModules(roles, engine, schedulers);

  const mechanicalRelays = (
    ["relay_1_countdown", "relay_2_countdown", "relay_3_countdown"] as const
  ).filter((role) => roles[role]).length;

  const claimed = new Set<string>();
  for (const resolved of Object.values(roles)) {
    claimed.add(resolved.entityId);
  }
  for (const scheduler of schedulers) {
    for (const resolved of Object.values(scheduler.roles)) {
      claimed.add(resolved.entityId);
    }
  }

  return {
    deviceId,
    kind,
    engine,
    modules,
    roles,
    schedulers,
    mechanicalRelays,
    unclaimed: entities.map((entity) => entity.entityId).filter((id) => !claimed.has(id)),
    warnings,
  };
}
