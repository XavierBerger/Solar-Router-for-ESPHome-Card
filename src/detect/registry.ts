import type { EntityRegistryEntry, HomeAssistant } from "../types/home-assistant";

/**
 * Access to the entity registry, which is where `original_name` lives.
 *
 * `hass.entities` gives us the device link cheaply but not `original_name`, so
 * the full registry is fetched once over the websocket and shared by every card
 * on the dashboard.
 *
 * The cache is not invalidated while the page is open. Renaming an entity is
 * harmless — we key on `original_name`, which does not change — but an entity
 * that appears after a reflash only shows up on the next page load. Subscribing
 * to `entity_registry_updated` is the follow-up.
 */
let registryCache: Promise<EntityRegistryEntry[]> | undefined;

export function loadEntityRegistry(hass: HomeAssistant): Promise<EntityRegistryEntry[]> {
  if (!registryCache) {
    registryCache = hass
      .callWS<EntityRegistryEntry[]>({ type: "config/entity_registry/list" })
      .catch((err: unknown) => {
        // Do not memoise a failure: a transient websocket error must not
        // disable the card until the user reloads.
        registryCache = undefined;
        throw err;
      });
  }
  return registryCache;
}

export function invalidateEntityRegistry(): void {
  registryCache = undefined;
}

/** One entity of a router, reduced to what detection and rendering need. */
export interface DeviceEntity {
  entityId: string;
  /** `switch`, `number`, `sensor`, … — half of the detection key. */
  domain: string;
  /** The ESPHome `name:`, verbatim. The other half of the detection key. */
  originalName: string | null;
  entityCategory: "config" | "diagnostic" | null;
}

export interface DeviceEntities {
  /** What Home Assistant exposes, and all detection ever looks at. */
  readonly enabled: DeviceEntity[];
  /**
   * Entities the user or the integration disabled.
   *
   * Kept rather than dropped so the card can tell "your firmware is old" from
   * "you disabled the diagnostic entities": the second looks exactly like the
   * first from the enabled list alone, and the advice differs completely.
   */
  readonly disabled: DeviceEntity[];
}

function toDeviceEntity(entry: EntityRegistryEntry): DeviceEntity {
  return {
    entityId: entry.entity_id,
    domain: entry.entity_id.split(".", 1)[0],
    originalName: entry.original_name,
    entityCategory: entry.entity_category,
  };
}

export async function loadDeviceEntities(
  hass: HomeAssistant,
  deviceId: string,
): Promise<DeviceEntities> {
  const registry = await loadEntityRegistry(hass);
  const enabled: DeviceEntity[] = [];
  const disabled: DeviceEntity[] = [];
  for (const entry of registry) {
    if (entry.device_id !== deviceId) {
      continue;
    }
    // `hidden_by` is deliberately not filtered: hiding a diagnostic entity is
    // common and must not blind the card.
    (entry.disabled_by ? disabled : enabled).push(toDeviceEntity(entry));
  }
  return { enabled, disabled };
}
