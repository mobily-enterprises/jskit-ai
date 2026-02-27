export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/console-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/workspace-console-core"
  ],
  "capabilities": {
    "provides": [
      "workspace.console.server-routes"
    ],
    "requires": [
      "auth.access",
      "contracts.http",
      "runtime.server",
      "workspace.console.core"
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
