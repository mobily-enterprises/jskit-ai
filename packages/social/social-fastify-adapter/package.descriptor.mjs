export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/social-fastify-adapter",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/http-contracts",
    "@jskit-ai/social-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/social-contracts"
  ],
  "capabilities": {
    "provides": [
      "social.routes"
    ],
    "requires": [
      "contracts.http",
      "social.core",
      "runtime.server",
      "contracts.social"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/http-contracts": "0.1.0"
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
