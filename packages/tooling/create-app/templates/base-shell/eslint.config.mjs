import { baseConfig, nodeConfig, webConfig } from "@jskit-ai/config-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  ...baseConfig,
  ...webConfig,
  ...nodeConfig
];
