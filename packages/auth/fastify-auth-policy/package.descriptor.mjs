export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/fastify-auth-policy",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/access-core",
    "@jskit-ai/rbac-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "auth.policy"
    ],
    "requires": [
      "runtime.server",
      "auth.access",
      "auth.rbac"
    ]
  },
  "runtime": {
    "server": {
      "entrypoint": "src/shared/server.js",
      "export": "createServerContributions"
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/cookie": "^11.0.2",
        "@fastify/csrf-protection": "^7.1.0",
        "@fastify/rate-limit": "^10.3.0",
        "@jskit-ai/server-runtime-core": "0.1.0"
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
