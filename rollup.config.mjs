import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

const dev = process.env.ROLLUP_WATCH === "true" || process.env.NODE_ENV === "development";

export default {
  input: "src/solar-router-card.ts",
  output: {
    // Stable filename, deliberately without a content hash: the Lovelace
    // resource URL a user configured must keep working across upgrades.
    file: "dist/solar-router-card.js",
    format: "es",
    sourcemap: dev,
  },
  plugins: [
    resolve(),
    typescript({ tsconfig: "./tsconfig.json", sourceMap: dev, inlineSources: dev }),
    ...(dev ? [] : [terser({ format: { comments: false } })]),
  ],
};
