export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/http-runtime",
  "version": "0.1.0",
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "contracts.http",
      "runtime.http-client"
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
        },
        {
          "entrypoint": "src/server/providers/HttpClientRuntimeServiceProvider.js",
          "export": "HttpClientRuntimeServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
        {
          "entrypoint": "src/client/providers/HttpContractsClientProvider.js",
          "export": "HttpContractsClientProvider"
        },
        {
          "entrypoint": "src/client/providers/HttpClientRuntimeClientProvider.js",
          "export": "HttpClientRuntimeClientProvider"
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
