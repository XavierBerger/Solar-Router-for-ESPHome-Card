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

import { CATALOG, SCHEDULER_ANCHOR, SCHEDULER_CATALOG, schedulerEntityName } from "./catalog";
import { PACKAGES, collectDeclaredPackages, compareVersions } from "./packages";
import type { DeviceEntity } from "./registry";
import {
  isWritableDomain,
  type DeclaredPackage,
  type DetectionWarning,
  type DeviceKind,
  type Domain,
  type EngineId,
  type FirmwareSupport,
  type PackageId,
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
  /**
   * Entity states, used only to read the version each package declares.
   *
   * Optional on purpose. Which packages exist is a registry fact; omitting the
   * states yields the same package list with every version still `pending`,
   * which is what lets the profile be computed once per device instead of on
   * every state change — `Real Power` alone ticks once a second.
   */
  readonly states?: Readonly<Record<string, { readonly state: string }>>;
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

/** Engine leaves, most specific first, to settle a build that declares two. */
const ENGINE_SPECIFICITY: readonly EngineId[] = [
  "engine_1dimmer_2switches_1bypass",
  "engine_1dimmer_2switches",
  "engine_1dimmer_1bypass",
  "engine_1switch",
  "engine_1dimmer",
];

/**
 * The engine, read from the declared packages.
 *
 * `engine_common` travels with every leaf and is therefore never the answer.
 * Two leaves at once cannot happen on a build that compiles, but a hand-rolled
 * config can produce one, so pick deterministically rather than by whichever
 * came first in the entity list.
 */
function engineFromPackages(declares: ReadonlySet<PackageId>): {
  readonly engine: EngineId | null;
  readonly conflicting: readonly EngineId[];
} {
  const found = ENGINE_SPECIFICITY.filter((id) => declares.has(id));
  return { engine: found[0] ?? null, conflicting: found.length > 1 ? found : [] };
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

  const packages = collectDeclaredPackages(entities, options.states);
  const declares = new Set<PackageId>(packages.map((declared) => declared.id));

  for (const declared of packages) {
    if (declared.versionState === "unexpected") {
      warnings.push({ code: "version_format_unexpected", entityId: declared.entityId });
    }
  }

  // A package name that only differs by case is a firmware typo. Say so rather
  // than silently ignoring the entity, which would look like a missing module.
  const known = new Map(Object.keys(PACKAGES).map((id) => [id.toLowerCase(), id]));
  for (const entity of entities) {
    const name = entity.originalName?.trim();
    if (
      !name ||
      entity.domain !== "sensor" ||
      Object.prototype.hasOwnProperty.call(PACKAGES, name)
    ) {
      continue;
    }
    const canonical = known.get(name.toLowerCase());
    if (canonical) {
      warnings.push({ code: "version_name_case_mismatch", name });
    }
  }

  const { engine, conflicting } = engineFromPackages(declares);
  if (conflicting.length > 0) {
    warnings.push({ code: "multiple_engines", engines: conflicting });
  } else if (!engine && declares.has("engine_common")) {
    warnings.push({ code: "engine_leaf_missing" });
  } else if (!engine && packages.length > 0 && roles.activate) {
    warnings.push({ code: "engine_not_declared" });
  }

  // What the device is, from what it declares rather than from what it happens
  // to publish: a proxy that is offline is still a power meter.
  const hasMeter = packages.some(
    (declared) =>
      PACKAGES[declared.id].category === "power_meter" && !PACKAGES[declared.id].implicit,
  );
  const kind: DeviceKind = engine ? "router" : hasMeter ? "power_meter" : "unknown";

  const schedulers = detectSchedulers(index);

  const regulators = packages.filter((declared) => PACKAGES[declared.id].category === "regulator");
  const mechanicalRelays = packages.filter(
    (declared) => declared.id === "regulator_mecanical_relay",
  ).length;
  const relayCountdowns = (
    ["relay_1_countdown", "relay_2_countdown", "relay_3_countdown"] as const
  ).filter((role) => roles[role]).length;

  const firmware = firmwareSupport(entities, packages, roles);

  const claimed = new Set<string>();
  for (const resolved of Object.values(roles)) {
    claimed.add(resolved.entityId);
  }
  for (const scheduler of schedulers) {
    for (const resolved of Object.values(scheduler.roles)) {
      claimed.add(resolved.entityId);
    }
  }
  // The version sensors are accounted for, so they must not resurface in the
  // generic rendering of leftovers.
  for (const declared of packages) {
    claimed.add(declared.entityId);
  }

  return {
    deviceId,
    firmware,
    kind,
    engine,
    packages,
    declares,
    regulators,
    roles,
    schedulers,
    mechanicalRelays,
    relayCountdowns,
    packagesVersion: highestVersion(packages),
    unclaimed: entities.map((entity) => entity.entityId).filter((id) => !claimed.has(id)),
    warnings,
  };
}

/** The highest version declared, or `null` if none has published yet. */
function highestVersion(packages: readonly DeclaredPackage[]): string | null {
  let best: string | null = null;
  for (const declared of packages) {
    if (!declared.version) {
      continue;
    }
    if (!best || compareVersions(declared.version, best) === 1) {
      best = declared.version;
    }
  }
  return best;
}

/**
 * Can the card work with this device?
 *
 * Only the registry is consulted, never a state. The version sensors publish
 * once about ten seconds after boot, so a card that asked "is the state a
 * semver?" would greet every freshly booted router with an upgrade notice.
 */
function firmwareSupport(
  entities: readonly DeviceEntity[],
  packages: readonly DeclaredPackage[],
  roles: Partial<Record<Role, ResolvedRole>>,
): FirmwareSupport {
  if (packages.length > 0) {
    return "supported";
  }
  if (entities.length === 0) {
    // Nothing in the registry yet — a device that has never connected, or a
    // cache read too early. Not an old router; do not guess.
    return "unknown";
  }
  const anchors = ["activate", "real_power", "router_level", "consumption"] as const;
  return anchors.some((role) => roles[role]) ? "outdated" : "not_a_router";
}
