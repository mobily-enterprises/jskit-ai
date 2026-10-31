import vueI18n from "@intlify/eslint-plugin-vue-i18n";
import { baseConfig, nodeConfig, typedFeaturesConfig, vueConfig, webConfig } from "./tooling/config-eslint/index.js";

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
  // JSKIT's own server code converts to typed features package by package. The
  // zero-warning lint leaves the rules off until then; each converted package
  // is listed in the typedFeaturesConfig([...]) after this entry, which
  // enforces them.
  ...typedFeaturesConfig(["**/src/server/**"], "off"),
  ...typedFeaturesConfig([
    "packages/kernel/server/**",
    "packages/http-runtime/src/server/**",
    "packages/database-runtime/src/server/**",
    "packages/database-runtime-mysql/src/server/**",
    "packages/database-runtime-postgres/src/server/**",
    "packages/json-rest-api-core/src/server/**",
    "packages/crud-core/src/server/**",
    "packages/auth-core/src/server/**",
    "packages/auth-provider-local-core/src/server/**",
    "packages/auth-provider-local-db-core/src/server/**",
    "packages/auth-provider-oidc-core/src/server/**",
    "packages/auth-provider-supabase-core/src/server/**",
    "packages/oidc-issuer-core/src/server/**",
    "packages/users-core/src/server/**",
    "packages/workspaces-core/src/server/**",
    "packages/console-core/src/server/**",
    "packages/storage-runtime/src/server/**",
    "packages/uploads-runtime/src/server/**",
    "packages/realtime/src/server/**",
    "packages/payments-core/src/server/**",
    "packages/rewarded-core/src/server/**",
    "packages/rewarded-web/src/server/**",
    "packages/auth-web/src/server/**",
    "packages/connectors-core/src/server/**",
    "packages/connector-google-calendar/src/server/**",
    "packages/connectors-catalog/src/server/**"
  ]),
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
