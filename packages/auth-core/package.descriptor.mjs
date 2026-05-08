export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-core",
  "version": "0.1.64",
  "kind": "runtime",
  "dependsOn": [
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "auth.access",
      "auth.policy"
    ],
    "requires": []
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/providers/AccessCoreServiceProvider.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/AccessCoreServiceProvider.js",
          "export": "AccessCoreServiceProvider"
        },
        {
          "entrypoint": "src/server/providers/FastifyAuthPolicyServiceProvider.js",
          "export": "FastifyAuthPolicyServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
        {
          "entrypoint": "src/client/providers/AccessCoreClientProvider.js",
          "export": "AccessCoreClientProvider"
        },
        {
          "entrypoint": "src/client/providers/FastifyAuthPolicyClientProvider.js",
          "export": "FastifyAuthPolicyClientProvider"
        }
      ]
    }
  },
  "metadata": {
    "apiSummary": {
      "surfaces": [
        {
          "subpath": "./client",
          "summary": "Exports client auth access APIs plus AccessCoreClientProvider/FastifyAuthPolicyClientProvider."
        },
        {
          "subpath": "./server",
          "summary": "Exports server auth access and Fastify auth policy providers plus server auth utility modules."
        },
        {
          "subpath": "./shared",
          "summary": "Exports shared auth client helpers (createApi and runAuthSignOutFlow), with structured subpaths at ./shared/authApi and ./shared/signOutFlow."
        }
      ],
      "containerTokens": {
        "server": [
          "auth.access"
        ],
        "client": [
          "auth.access.client"
        ]
      }
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/kernel": "0.1.65",
        "@fastify/cookie": "^11.0.2",
        "@fastify/csrf-protection": "^7.1.0",
        "@fastify/rate-limit": "^10.3.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": [],
    "text": []
  }
});
