import { defineConfig } from "tsup"
import { solidPlugin } from "esbuild-plugin-solid"

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "node20",
    outDir: "dist",
    sourcemap: true,
    external: ["@opencode-ai/plugin"],
  },
  {
    entry: ["src/tui.tsx"],
    format: ["esm"],
    dts: true,
    clean: false,
    target: "node20",
    outDir: "dist",
    sourcemap: true,
    external: ["solid-js", "solid-js/web", "solid-js/store", "@opentui/core", "@opentui/solid", "@opencode-ai/plugin"],
    esbuildPlugins: [
      solidPlugin({ solid: { generate: "universal", hydratable: false, moduleName: "@opentui/solid" } }),
    ],
  },
])
