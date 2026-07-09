export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-provider-local-core",
  "version": "0.1.7",
  "kind": "runtime",
  "description": "Local auth provider with a file backend default and no database requirement.",
  "dependsOn": [
    "@jskit-ai/auth-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "auth.provider.local",
      "auth.provider"
    ],
    "requires": [
      "auth.access"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/providers/AuthLocalServiceProvider.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/AuthLocalServiceProvider.js",
          "export": "AuthLocalServiceProvider"
        },
        {
          "entrypoint": "src/server/providers/AuthProviderServiceProvider.js",
          "export": "AuthProviderServiceProvider"
        }
      ]
    }
  },
  "metadata": {
    "apiSummary": {
      "surfaces": [
        {
          "subpath": "./server/providers/AuthLocalServiceProvider",
          "summary": "Exports the local auth provider service provider."
        },
        {
          "subpath": "./server/lib/index",
          "summary": "Exports local auth service, file backend helpers, and password strategy helpers."
        }
      ],
      "containerTokens": {
        "server": [
          "authService",
          "auth.local.backend",
          "auth.local.passwordStrategy"
        ],
        "client": []
      }
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/auth-core": "0.1.106",
        "@jskit-ai/kernel": "0.1.108",
        "nodemailer": "^7.0.10",
        "dotenv": "^16.4.5"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": [],
    "text": [
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "AUTH_PROVIDER",
        "value": "local",
        "reason": "Select local auth as the auth provider.",
        "category": "runtime-config",
        "id": "auth-provider"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "AUTH_LOCAL_BACKEND",
        "value": "file",
        "reason": "Use the built-in local file auth backend.",
        "category": "runtime-config",
        "id": "auth-local-backend"
      },
      {
        "file": ".gitignore",
        "op": "append-text",
        "position": "bottom",
        "skipIfContains": ".jskit/auth/",
        "value": "\n.jskit/auth/\n",
        "reason": "Ignore local auth runtime state.",
        "category": "runtime-state",
        "id": "auth-local-store-gitignore"
      }
    ]
  }
});
