import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: ["@agentability/evaluator", "@agentability/shared"],
  outDir: "lib",
});
