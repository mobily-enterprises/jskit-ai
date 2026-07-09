export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/auth-provider-local-db-core",
  version: "0.1.5",
  kind: "runtime",
  description: "Database-backed local auth storage backend for JSKIT local auth.",
  dependsOn: [
    "@jskit-ai/auth-provider-local-core",
    "@jskit-ai/database-runtime"
  ],
  capabilities: {
    provides: [
      "auth.local.backend.db"
    ],
    requires: [
      "runtime.database"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/providers/AuthLocalDbBackendServiceProvider.js",
          export: "AuthLocalDbBackendServiceProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    jskit: {
      tableOwnership: {
        tables: [
          {
            tableName: "auth_local_users",
            provenance: "auth-provider-local-db-core",
            ownerKind: "package"
          },
          {
            tableName: "auth_local_sessions",
            provenance: "auth-provider-local-db-core",
            ownerKind: "package"
          },
          {
            tableName: "auth_local_recovery",
            provenance: "auth-provider-local-db-core",
            ownerKind: "package"
          }
        ]
      }
    },
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/providers/AuthLocalDbBackendServiceProvider",
          summary: "Exports the service provider that registers auth.local.backend for AUTH_LOCAL_BACKEND=db."
        },
        {
          subpath: "./server/lib/index",
          summary: "Exports the DB local auth backend factory."
        }
      ],
      containerTokens: {
        server: [
          "auth.local.backend"
        ],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-provider-local-core": "0.1.13",
        "@jskit-ai/database-runtime": "0.1.113",
        "@jskit-ai/kernel": "0.1.114"
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
        from: "templates/migrations/auth_local_db_initial.cjs",
        toDir: "migrations",
        extension: ".cjs",
        reason: "Install DB-backed local auth credential, session, and recovery tables.",
        category: "auth-local-db",
        id: "auth-local-db-initial-schema"
      }
    ],
    text: [
      {
        file: ".env",
        op: "upsert-env",
        key: "AUTH_LOCAL_BACKEND",
        value: "db",
        reason: "Use the database-backed local auth backend.",
        category: "runtime-config",
        id: "auth-local-backend-db"
      }
    ]
  }
});
