export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/http-contracts",
  "version": "0.1.0",
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "contracts.http"
    ],
    "requires": []
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/HttpContractsServiceProvider.js",
          "export": "HttpContractsServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
        {
          "entrypoint": "src/client/providers/HttpContractsClientProvider.js",
          "export": "HttpContractsClientProvider"
        }
      ]
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "typebox": "^1.0.81"
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
