import { baseConfig, nodeConfig, webConfig } from "@jskit-ai/config-eslint/server";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  ...baseConfig,
  ...webConfig,
  ...nodeConfig
];
