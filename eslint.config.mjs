import vueI18n from "@intlify/eslint-plugin-vue-i18n";
import { baseConfig, nodeConfig, vueConfig, webConfig } from "./tooling/config-eslint/index.js";

// JSKIT client texts come from message catalogs. A package joins this list once
// its screens are translated; when the work is finished every client package is on it.
const TRANSLATED_CLIENT_PACKAGES = (process.env.JSKIT_I18N_LINT_PACKAGES || "").split(",").filter(Boolean);

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
  ...(TRANSLATED_CLIENT_PACKAGES.length > 0
    ? [{
      files: TRANSLATED_CLIENT_PACKAGES.map((name) => `packages/${name}/src/client/**/*.vue`),
      plugins: { "@intlify/vue-i18n": vueI18n },
      rules: { "@intlify/vue-i18n/no-raw-text": "error" }
    }]
    : []),
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
