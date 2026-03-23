import { baseConfig, nodeConfig, vueConfig, webConfig } from "./tooling/config-eslint/index.js";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.cache/**",
      "**/.jskit/**",
      "packages/**/templates/**",
      "tooling/create-app/templates/**",
      "LEGACY/**"
    ]
  },
  ...baseConfig,
  ...webConfig,
  ...nodeConfig,
  ...vueConfig,
  {
    files: ["**/*.{js,mjs,cjs,vue}"],
    rules: {
      "no-useless-escape": "off",
      "no-empty": "off",
      "no-extra-boolean-cast": "off",
      "no-unused-vars": [
        "error",
        {
          args: "none",
          caughtErrors: "none",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_"
        }
      ],
      "vue/no-v-html": "off",
      "vue/attribute-hyphenation": "off"
    }
  }
];
