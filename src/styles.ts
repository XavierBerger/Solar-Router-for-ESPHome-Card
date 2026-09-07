import { css } from "lit";

/**
 * Every colour comes from a Home Assistant theme variable, so light, dark and
 * user themes all render correctly without the card knowing which one is
 * active. Each variable carries a fallback for the rare theme that omits it.
 */
export const cardStyles = css`
  :host {
    display: block;
  }

  .content {
    padding: 0 16px 16px;
  }

  .placeholder {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    color: var(--secondary-text-color, #727272);
  }

  .error {
    padding: 16px;
    color: var(--error-color, #db4437);
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
  }

  .label {
    color: var(--secondary-text-color, #727272);
  }

  .value {
    color: var(--primary-text-color, #212121);
    font-weight: 500;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--secondary-text-color, #727272);
    font-size: 0.9em;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success-color, #43a047);
  }

  .dot.offline {
    background: var(--error-color, #db4437);
  }

  details {
    margin-top: 12px;
    border-top: 1px solid var(--divider-color, #e0e0e0);
    padding-top: 8px;
  }

  summary {
    cursor: pointer;
    color: var(--secondary-text-color, #727272);
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::before {
    content: "▸";
    display: inline-block;
    width: 1em;
    transition: transform 120ms ease;
  }

  details[open] > summary::before {
    transform: rotate(90deg);
  }

  .entities {
    margin-top: 8px;
    max-height: 320px;
    overflow-y: auto;
  }

  .entity {
    display: grid;
    grid-template-columns: 5.5em 1fr auto;
    gap: 8px;
    padding: 2px 0;
    font-size: 0.9em;
  }

  .domain {
    color: var(--secondary-text-color, #727272);
    font-family: var(--code-font-family, monospace);
  }

  .unnamed {
    color: var(--warning-color, #ffa600);
  }

  @media (max-width: 450px) {
    .entity {
      grid-template-columns: 1fr auto;
    }

    .domain {
      display: none;
    }
  }
`;
