import vueI18n from "@intlify/eslint-plugin-vue-i18n";
import {
  baseConfig,
  clientFeaturesConfig,
  nodeConfig,
  sizeLimitsConfig,
  typedFeaturesConfig,
  vueConfig,
  webConfig
} from "./tooling/config-eslint/index.js";

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
  // The typed-features rules apply, as errors, to the server and shared code of
  // the packages listed in the second typedFeaturesConfig([...]); every other
  // server tree has them off, so the zero-warning lint reports only those.
  ...typedFeaturesConfig(["**/src/server/**"], "off"),
  ...typedFeaturesConfig([
    "packages/kernel/server/**",
    "packages/agent/src/server/**",
    "packages/agent-runtime/src/server/**",
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
    "packages/connectors-catalog/src/server/**",
    "packages/assistant-core/src/server/**",
    "packages/assistant-runtime/src/server/**",
    "packages/assistant-voice/src/server/**",
    "packages/assistant-voice-sherpa/src/**",
    "packages/kernel/shared/**",
    "packages/http-runtime/src/shared/**",
    "packages/database-runtime/src/shared/**",
    "packages/database-runtime-mysql/src/shared/**",
    "packages/database-runtime-postgres/src/shared/**",
    "packages/auth-core/src/shared/**",
    "packages/auth-provider-oidc-core/src/shared/**",
    "packages/users-core/src/shared/**",
    "packages/workspaces-core/src/shared/**",
    "packages/console-core/src/shared/**",
    "packages/uploads-runtime/src/shared/**",
    "packages/realtime/src/shared/**",
    "packages/payments-core/src/shared/**",
    "packages/rewarded-core/src/shared/**",
    "packages/rewarded-web/src/shared/**",
    "packages/connectors-core/src/shared/**",
    "packages/connector-google-calendar/src/shared/**",
    "packages/connectors-catalog/src/shared/**",
    "packages/assistant-core/src/shared/**",
    "packages/assistant-runtime/src/shared/**",
    "packages/assistant-voice/src/shared/**"
  ]),
  // Every other hand-written file stays under 750 lines and every function under 600.
  ...sizeLimitsConfig(["packages/**", "tooling/**", "scripts/**"]),
  ...webConfig,
  ...nodeConfig,
  ...vueConfig,
  // The client typed-features rules apply, as errors, to all client code: every package's src/client, the kernel's
  // client, the tooling's client entries, and the client code of the pattern examples applications copy (at the
  // rewarded example's root, and under the other examples' books, src, expected-existing/src and packages/*/src/client).
  ...clientFeaturesConfig([
    "packages/*/src/client/**",
    "packages/kernel/client/**",
    "tooling/*/src/client/**",
    "packages/*/patterns/*/example/books/**",
    "packages/*/patterns/*/example/expected-existing/src/**",
    "packages/*/patterns/*/example/packages/*/src/client/**",
    "packages/*/patterns/*/example/src/**",
    "packages/rewarded-web/patterns/google-rewarded/example/**"
  ]),
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
