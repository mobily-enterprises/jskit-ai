import vueI18n from "@intlify/eslint-plugin-vue-i18n";
import { baseConfig, nodeConfig, vueConfig, webConfig } from "./tooling/config-eslint/index.js";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.vitepress/cache/**",
      "**/coverage/**",
      "**/.cache/**",
      "**/.jskit/**",
      "packages/**/templates/**"
    ]
  },
  ...baseConfig,
  ...webConfig,
  ...nodeConfig,
  ...vueConfig,
  {
    // JSKIT client texts come from message catalogs, never from template literals.
    files: ["packages/*/src/**/*.vue"],
    plugins: { "@intlify/vue-i18n": vueI18n },
    rules: { "@intlify/vue-i18n/no-raw-text": "error" }
  },
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
