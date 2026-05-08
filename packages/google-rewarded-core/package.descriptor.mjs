export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/google-rewarded-core",
  version: "0.1.2",
  kind: "runtime",
  description: "Google rewarded workflow runtime plus internal CRUD providers for rules, provider configs, watch sessions, and unlock receipts.",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/crud-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/json-rest-api-core",
    "@jskit-ai/kernel",
    "@jskit-ai/resource-crud-core",
    "@jskit-ai/workspaces-core"
  ],
  capabilities: {
    provides: [
      "crud.google-rewarded-rules",
      "crud.google-rewarded-provider-configs",
      "crud.google-rewarded-watch-sessions",
      "crud.google-rewarded-unlock-receipts",
      "google-rewarded.core"
    ],
    requires: [
      "runtime.actions",
      "runtime.database",
      "auth.policy",
      "json-rest-api.core"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/rules/GoogleRewardedRulesProvider.js",
          export: "GoogleRewardedRulesProvider"
        },
        {
          entrypoint: "src/server/providerConfigs/GoogleRewardedProviderConfigsProvider.js",
          export: "GoogleRewardedProviderConfigsProvider"
        },
        {
          entrypoint: "src/server/watchSessions/GoogleRewardedWatchSessionsProvider.js",
          export: "GoogleRewardedWatchSessionsProvider"
        },
        {
          entrypoint: "src/server/unlockReceipts/GoogleRewardedUnlockReceiptsProvider.js",
          export: "GoogleRewardedUnlockReceiptsProvider"
        },
        {
          entrypoint: "src/server/GoogleRewardedCoreProvider.js",
          export: "GoogleRewardedCoreProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    jskit: {
      scaffoldShape: "crud-server-v1",
      tableOwnership: {
        tables: [
          {
            tableName: "google_rewarded_rules",
            provenance: "crud-server-generator",
            ownerKind: "crud-package",
            providerEntrypoint: "src/server/rules/GoogleRewardedRulesProvider.js",
            ownershipFilter: "workspace"
          },
          {
            tableName: "google_rewarded_provider_configs",
            provenance: "crud-server-generator",
            ownerKind: "crud-package",
            providerEntrypoint: "src/server/providerConfigs/GoogleRewardedProviderConfigsProvider.js",
            ownershipFilter: "workspace"
          },
          {
            tableName: "google_rewarded_watch_sessions",
            provenance: "crud-server-generator",
            ownerKind: "crud-package",
            providerEntrypoint: "src/server/watchSessions/GoogleRewardedWatchSessionsProvider.js",
            ownershipFilter: "workspace_user"
          },
          {
            tableName: "google_rewarded_unlock_receipts",
            provenance: "crud-server-generator",
            ownerKind: "crud-package",
            providerEntrypoint: "src/server/unlockReceipts/GoogleRewardedUnlockReceiptsProvider.js",
            ownershipFilter: "workspace_user"
          }
        ]
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./shared",
          summary: "Exports Google rewarded shared CRUD resources."
        },
        {
          subpath: "./server/actions",
          summary: "Exports Google rewarded workflow action identifiers and validators."
        },
        {
          subpath: "./server/requireGoogleRewardedUnlock",
          summary: "Exports the server helper that enforces a rewarded unlock before a protected feature action continues."
        }
      ],
      containerTokens: {
        server: [
          "repository.google_rewarded_rules",
          "crud.google_rewarded_rules",
          "repository.google_rewarded_provider_configs",
          "crud.google_rewarded_provider_configs",
          "repository.google_rewarded_watch_sessions",
          "crud.google_rewarded_watch_sessions",
          "repository.google_rewarded_unlock_receipts",
          "crud.google_rewarded_unlock_receipts",
          "google-rewarded.core.service"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-core": "0.1.64",
        "@jskit-ai/crud-core": "0.1.73",
        "@jskit-ai/database-runtime": "0.1.65",
        "@jskit-ai/http-runtime": "0.1.64",
        "@jskit-ai/json-rest-api-core": "0.1.10",
        "@jskit-ai/kernel": "0.1.65",
        "@jskit-ai/resource-crud-core": "0.1.10",
        "@jskit-ai/workspaces-core": "0.1.41"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        op: "install-migration",
        from: "templates/migrations/google_rewarded_rules_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install Google rewarded rules schema migration.",
        category: "google-rewarded",
        id: "google-rewarded-rules-initial-schema"
      },
      {
        op: "install-migration",
        from: "templates/migrations/google_rewarded_provider_configs_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install Google rewarded provider config schema migration.",
        category: "google-rewarded",
        id: "google-rewarded-provider-configs-initial-schema"
      },
      {
        op: "install-migration",
        from: "templates/migrations/google_rewarded_watch_sessions_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install Google rewarded watch sessions schema migration.",
        category: "google-rewarded",
        id: "google-rewarded-watch-sessions-initial-schema"
      },
      {
        op: "install-migration",
        from: "templates/migrations/google_rewarded_unlock_receipts_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install Google rewarded unlock receipts schema migration.",
        category: "google-rewarded",
        id: "google-rewarded-unlock-receipts-initial-schema"
      }
    ],
    text: []
  }
});
