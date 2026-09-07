/**
 * Minimal, hand-written typings for the parts of the `hass` object this card
 * uses.
 *
 * Home Assistant does not publish types for custom cards, so declaring only
 * what we consume keeps the surface honest: anything not described here is
 * something the card must not rely on.
 */

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    device_class?: string;
    min?: number;
    max?: number;
    step?: number;
    mode?: string;
    [key: string]: unknown;
  };
  last_changed: string;
  last_updated: string;
}

/** Entry of `hass.entities` — the entity registry as the frontend caches it. */
export interface EntityRegistryDisplayEntry {
  entity_id: string;
  device_id?: string;
  area_id?: string;
  hidden?: boolean;
  entity_category?: "config" | "diagnostic";
  platform?: string;
  translation_key?: string;
  display_precision?: number;
}

/** Entry of `hass.devices` — the device registry as the frontend caches it. */
export interface DeviceRegistryDisplayEntry {
  id: string;
  name: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  sw_version?: string | null;
  area_id?: string | null;
}

/**
 * Full entity registry entry, as returned by the `config/entity_registry/list`
 * websocket command.
 *
 * `original_name` is the reason this call exists: it is the ESPHome `name:`
 * verbatim, it survives the user renaming the entity, and it is the only handle
 * for the entities the firmware declares without an `id:`. See AGENTS.md.
 */
export interface EntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  platform: string;
  unique_id: string;
  name: string | null;
  original_name: string | null;
  entity_category: "config" | "diagnostic" | null;
  disabled_by: string | null;
  hidden_by: string | null;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryDisplayEntry>;
  language: string;
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
}

/** Entry pushed to `window.customCards` so the card shows up in the picker. */
export interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}
