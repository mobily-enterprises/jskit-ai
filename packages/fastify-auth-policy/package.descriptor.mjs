export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/fastify-auth-policy",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "auth.policy"
    ],
    "requires": [
      "auth.access",
      "auth.rbac"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/FastifyAuthPolicyServiceProvider.js",
          "export": "FastifyAuthPolicyServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
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
        "@fastify/cookie": "^11.0.2",
        "@fastify/csrf-protection": "^7.1.0",
        "@fastify/rate-limit": "^10.3.0",
        "@jskit-ai/kernel": "0.1.0"
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
