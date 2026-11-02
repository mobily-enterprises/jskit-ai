import {
  baseConfig,
  formatterConfig,
  nodeConfig,
  sizeLimitsConfig,
  typedFeaturesConfig,
  vueConfig,
  webConfig
} from "@jskit-ai/config-eslint/server";

// The checks of https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features, as errors.
const SERVER_SOURCES = ["packages/*/src/server/**", "packages/*/src/shared/**", "server/**", "server.js"];
const HAND_WRITTEN_SOURCES = ["packages/*/src/**", "src/**", "config/**", "server/**", "server.js", "bin/**"];

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "test-results/**", ".jskit/**"]
  },
  {
    files: ["src/pages/**/*.vue"],
    languageOptions: {
      globals: {
        definePage: "readonly"
      }
    }
  },
  ...baseConfig,
  ...typedFeaturesConfig(SERVER_SOURCES),
  ...sizeLimitsConfig(HAND_WRITTEN_SOURCES),
  ...vueConfig,
  ...webConfig,
  ...nodeConfig,
  ...formatterConfig([...SERVER_SOURCES, "config/**", "bin/**"])
];
