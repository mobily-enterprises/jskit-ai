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
  "metadata": {
    "apiSummary": {
      "surfaces": [
        {
          "subpath": "./client",
          "summary": "Exports HTTP client runtime APIs (createHttpClient and transport helpers) plus client providers."
        },
        {
          "subpath": "./server",
          "summary": "Exports service providers only (HttpContractsServiceProvider, HttpClientRuntimeServiceProvider)."
        },
        {
          "subpath": "./shared",
          "summary": "Exports HTTP contract/schema utilities, with structured contract subpaths under ./shared/contracts/*."
        }
      ],
      "containerTokens": {
        "server": [
          "contracts.http",
          "runtime.http-client"
        ],
        "client": [
          "contracts.http.client",
          "runtime.http-client.client"
        ]
      }
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
