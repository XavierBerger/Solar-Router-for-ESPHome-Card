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

export async function loadDeviceEntities(
  hass: HomeAssistant,
  deviceId: string,
): Promise<DeviceEntity[]> {
  const registry = await loadEntityRegistry(hass);
  return registry
    .filter((entry) => entry.device_id === deviceId && !entry.disabled_by)
    .map((entry) => ({
      entityId: entry.entity_id,
      domain: entry.entity_id.split(".", 1)[0],
      originalName: entry.original_name,
      entityCategory: entry.entity_category,
    }));
}
