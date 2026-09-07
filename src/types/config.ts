/** How a section may be forced on or off, overriding automatic detection. */
export type SectionMode = "auto" | "show" | "hide";

export interface SolarRouterCardConfig {
  type: string;
  /** Device registry id of the router. Chosen with the device picker. */
  device_id?: string;
  /** Overrides the card title, which otherwise follows the device name. */
  name?: string;
  /** Initial state of the Advanced section. */
  advanced_open?: boolean;
  /** Per-section override, keyed by section id. */
  sections?: Record<string, SectionMode>;
  /** Role → entity_id override, for installations detection cannot resolve. */
  entities?: Record<string, string>;
}
