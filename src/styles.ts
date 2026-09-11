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

  /* Compatibility screens: no controls, one clear thing to do. */
  .notice {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    align-items: start;
    padding: 12px;
    border-radius: 8px;
    background: var(--secondary-background-color, #f5f5f5);
  }

  .notice ha-icon {
    grid-row: 1 / span 99;
    color: var(--primary-color, #03a9f4);
  }

  .notice p {
    grid-column: 2;
    margin: 0 0 8px;
    line-height: 1.4;
  }

  .actions {
    grid-column: 2;
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .actions a {
    color: var(--primary-color, #03a9f4);
  }

  button.reload,
  button.link {
    padding: 6px 12px;
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 6px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color, #212121);
    font: inherit;
    cursor: pointer;
  }

  button.link {
    margin-top: 8px;
    border: none;
    padding: 4px 0;
    color: var(--primary-color, #03a9f4);
  }

  /* What the router is made of, now that the firmware says so. */
  .hardware {
    margin-top: 12px;
    display: grid;
    gap: 4px;
  }

  .hardware .row {
    display: grid;
    grid-template-columns: 9em 1fr;
    gap: 8px;
  }

  .hardware .label {
    color: var(--secondary-text-color, #727272);
  }

  .modules summary .version {
    float: right;
    color: var(--secondary-text-color, #727272);
    font-size: 0.9em;
  }

  .entity ha-icon {
    --mdc-icon-size: 18px;
    color: var(--state-icon-color, #44739e);
    margin-right: 4px;
  }

  @media (max-width: 450px) {
    .hardware .row {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 450px) {
    .entity {
      grid-template-columns: 1fr auto;
    }

    .domain {
      display: none;
    }
  }

  /* Control sections. */
  .section {
    margin-top: 14px;
  }

  .section-title {
    font-weight: 500;
    color: var(--primary-text-color, #212121);
    margin-bottom: 6px;
  }

  .control-row {
    display: grid;
    grid-template-columns: minmax(8em, 14em) 1fr;
    gap: 8px 12px;
    align-items: center;
    padding: 4px 0;
  }

  .control-label {
    display: flex;
    flex-direction: column;
  }

  .control-label .note {
    color: var(--secondary-text-color, #727272);
    font-size: 0.82em;
    line-height: 1.3;
  }

  .control-value {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-end;
  }

  .control-value ha-selector {
    flex: 1;
    min-width: 0;
  }

  .readout {
    font-variant-numeric: tabular-nums;
  }

  .aside,
  .dim {
    color: var(--secondary-text-color, #727272);
    font-size: 0.9em;
  }

  .advanced {
    margin-top: 18px;
    border-top: 1px solid var(--divider-color, #e0e0e0);
    padding-top: 10px;
  }

  .advanced > summary {
    cursor: pointer;
    font-weight: 500;
  }

  @media (max-width: 450px) {
    .control-row {
      grid-template-columns: 1fr;
    }

    .control-value {
      justify-content: flex-start;
    }
  }
`;

/**
 * The GUI editor.
 *
 * Rendered inside Home Assistant's own configuration dialog rather than in a
 * card, so it borrows the dialog's spacing and only styles what it adds.
 */
export const editorStyles = css`
  :host {
    display: block;
  }

  .notice {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--secondary-background-color, #f5f5f5);
    line-height: 1.4;
  }

  .notice.warn {
    border-left: 4px solid var(--warning-color, #ffa600);
  }

  .notice.error {
    border-left: 4px solid var(--error-color, #db4437);
  }

  .recognised {
    margin-top: 16px;
    padding: 12px;
    border-radius: 8px;
    background: var(--secondary-background-color, #f5f5f5);
  }

  .heading {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-weight: 500;
    margin-bottom: 8px;
  }

  .heading .version,
  .modules summary .version {
    color: var(--secondary-text-color, #727272);
    font-size: 0.9em;
    font-weight: 400;
  }

  .hardware {
    display: grid;
    gap: 4px;
    margin-bottom: 8px;
  }

  .hardware .row {
    display: grid;
    grid-template-columns: 9em 1fr;
    gap: 8px;
  }

  .hardware .label {
    color: var(--secondary-text-color, #727272);
  }

  .entities {
    display: grid;
    gap: 2px;
  }

  .entity {
    display: grid;
    grid-template-columns: 8em 1fr auto;
    gap: 8px;
    font-size: 0.9em;
  }

  .entity .domain {
    color: var(--secondary-text-color, #727272);
  }

  .entity ha-icon {
    --mdc-icon-size: 18px;
    color: var(--state-icon-color, #44739e);
    margin-right: 4px;
  }

  button.link {
    margin-top: 8px;
    padding: 4px 0;
    border: none;
    background: none;
    color: var(--primary-color, #03a9f4);
    font: inherit;
    cursor: pointer;
  }

  .diagnostic {
    margin-top: 10px;
    font-size: 0.9em;
  }

  .diagnostic ul {
    margin: 6px 0 0;
    padding-left: 18px;
    line-height: 1.4;
  }

  @media (max-width: 450px) {
    .hardware .row,
    .entity {
      grid-template-columns: 1fr;
    }
  }
`;
