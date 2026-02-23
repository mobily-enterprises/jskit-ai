import { baseConfig, nodeConfig, webConfig, vueConfig } from "@jskit-ai/config-eslint";

export default [
  {
    ignores: [
      "dist/**",
      "dist-*/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "coverage-client/**",
      "coverage-vue/**"
    ]
  },
  ...baseConfig,
  ...webConfig,
  ...nodeConfig,
  ...vueConfig,
  {
    files: ["server/**/*.service.js"],
    rules: {
      "max-lines": [
        "error",
        {
          max: 750,
          skipBlankLines: true,
          skipComments: true
        }
      ]
    }
  }
];
