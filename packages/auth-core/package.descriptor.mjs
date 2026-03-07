export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "auth.access",
      "auth.rbac",
      "auth.policy"
    ],
    "requires": []
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/AccessCoreServiceProvider.js",
          "export": "AccessCoreServiceProvider"
        },
        {
          "entrypoint": "src/server/providers/RbacServiceProvider.js",
          "export": "RbacServiceProvider"
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
          "entrypoint": "src/client/providers/RbacClientProvider.js",
          "export": "RbacClientProvider"
        },
        {
          "entrypoint": "src/client/providers/FastifyAuthPolicyClientProvider.js",
          "export": "FastifyAuthPolicyClientProvider"
        }
      ]
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/kernel": "0.1.0",
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
    "files": []
  }
});
