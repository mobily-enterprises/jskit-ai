export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-fastify-routes",
  "version": "0.1.0",
  "description": "Fastify controller/routes/schema wiring for workspace APIs.",
  "dependsOn": [
    "@jskit-ai/workspace-service-core",
    "@jskit-ai/access-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "workspace.server-routes"
    ],
    "requires": [
      "workspace.service",
      "auth.access",
      "contracts.http",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0",
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
