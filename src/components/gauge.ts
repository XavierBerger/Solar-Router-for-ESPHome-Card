/**
 * The routing gauge — inline SVG, no charting dependency.
 *
 * A 270° arc rather than a full circle: the gap at the bottom gives the reading
 * a base and makes zero unmistakable, which a closed ring does not.
 */

import { html, svg, type TemplateResult } from "lit";

const CENTRE = 50;
const RADIUS = 40;
/** Sweep of the arc, in degrees. The 90° gap sits at the bottom. */
const SWEEP = 270;
/** Length of the drawn arc, which is what the dash offset works against. */
export const ARC_LENGTH = 2 * Math.PI * RADIUS * (SWEEP / 360);

function pointAt(degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  // SVG's y axis points down, hence the subtraction.
  return [CENTRE + RADIUS * Math.cos(radians), CENTRE - RADIUS * Math.sin(radians)];
}

const [startX, startY] = pointAt(225);
const [endX, endY] = pointAt(-45);
const ARC = `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${RADIUS} ${RADIUS} 0 1 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`;

/**
 * How much of the arc to leave undrawn for a given percentage.
 *
 * Exported because it is the whole of the gauge's arithmetic, and an off-by-one
 * here is invisible on screen until someone compares it with the number.
 */
export function dashOffset(percent: number): number {
  const clamped = Math.min(100, Math.max(0, percent));
  return ARC_LENGTH * (1 - clamped / 100);
}

export interface GaugeOptions {
  /** 0–100, or null when the value cannot be read. */
  readonly percent: number | null;
  readonly caption: string;
  /** Shown instead of a percentage — the all-or-nothing engine has no level. */
  readonly text?: string;
}

export function renderGauge(options: GaugeOptions): TemplateResult {
  const { percent } = options;
  const value = percent ?? 0;

  return html`
    <div class="gauge">
      <svg viewBox="0 0 100 100" role="img" aria-label=${options.caption}>
        ${svg`
          <path class="gauge-track" d=${ARC} />
          <path
            class="gauge-value"
            d=${ARC}
            stroke-dasharray=${ARC_LENGTH}
            stroke-dashoffset=${percent === null ? ARC_LENGTH : dashOffset(value)}
          />
        `}
      </svg>
      <div class="gauge-reading">
        <span class="gauge-number"
          >${options.text ?? (percent === null ? "—" : `${Math.round(value)}%`)}</span
        >
        <span class="gauge-caption">${options.caption}</span>
      </div>
    </div>
  `;
}
