export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-fastify-adapter",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/fastify-auth-policy"
  ],
  "capabilities": {
    "provides": [
      "auth.routes"
    ],
    "requires": [
      "auth.access",
      "contracts.http",
      "auth.policy"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/access-core": "0.1.0",
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
