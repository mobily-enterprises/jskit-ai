import { baseConfig, nodeConfig, typedFeaturesConfig, vueConfig, webConfig } from "@jskit-ai/config-eslint/server";

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
  // Server code follows JSKIT's typed features from the start.
  ...typedFeaturesConfig(["packages/*/src/server/**", "server/**", "server.js"]),
  ...vueConfig,
  ...webConfig,
  ...nodeConfig
];
