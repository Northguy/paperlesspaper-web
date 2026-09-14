import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: Object.fromEntries(
      ["helpers", "ducks", "components", "translation", "scss"].map((name) => [
        name,
        fileURLToPath(new URL(`./src/${name}`, import.meta.url)),
      ])
    ),
  },
  test: { include: ["tests/unit/**/*.test.{ts,tsx}"] },
});
