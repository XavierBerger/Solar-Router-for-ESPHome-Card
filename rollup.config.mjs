import resolve from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

const dev = process.env.ROLLUP_WATCH === "true" || process.env.NODE_ENV === "development";
const demo = process.env.BUILD_DEMO === "true";

const production = {
  input: "src/solar-router-card.ts",
  output: {
    // Stable filename, deliberately without a content hash: the Lovelace
    // resource URL a user configured must keep working across upgrades.
    file: "dist/solar-router-card.js",
    format: "es",
    sourcemap: dev,
    // HACS installs one file and nothing beside it, so the editor's dynamic
    // import has to be folded back in rather than split into a second chunk.
    inlineDynamicImports: true,
  },
  plugins: [
    resolve(),
    json(),
    typescript({ tsconfig: "./tsconfig.json", sourceMap: dev, inlineSources: dev }),
    ...(dev ? [] : [terser({ format: { comments: false } })]),
  ],
};

/**
 * The demo bundle, built only when asked for.
 *
 * A separate entry point is what keeps the fixtures out of production: they are
 * reachable from `dev/demo-entry.ts` and from nowhere under `src/`, so
 * `dist/solar-router-card.js` cannot pick them up however the tree is shaken.
 */
const demoBundle = {
  input: "dev/demo-entry.ts",
  output: { file: "dist/solar-router-demo.js", format: "es", sourcemap: true },
  plugins: [
    resolve(),
    json(),
    // The demo reaches into `test/fixtures`, which `tsconfig.json` does not
    // cover; `tsconfig.test.json` includes both trees.
    typescript({ tsconfig: "./tsconfig.test.json", sourceMap: true, inlineSources: true }),
  ],
};

export default demo ? [production, demoBundle] : production;
