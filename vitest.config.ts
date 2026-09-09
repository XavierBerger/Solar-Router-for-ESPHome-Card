import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Detection is pure: it takes an entity list, not `hass`, so it needs no
    // DOM. The render tests of phase 3 will add their own environment.
    environment: "node",
    include: ["test/**/*.spec.ts"],
  },
});
