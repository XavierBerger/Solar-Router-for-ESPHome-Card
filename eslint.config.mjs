import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      // Home Assistant's runtime state, and the bundles deployed into it.
      "dev/homeassistant/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `tsconfig.test.json` covers both trees: `tsconfig.json` includes only
    // `src`, so type-aware linting would refuse every file under `test`.
    files: ["src/**/*.ts", "test/**/*.ts", "dev/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.test.json" },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
