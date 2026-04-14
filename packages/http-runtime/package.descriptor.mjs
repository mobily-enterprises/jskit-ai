export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/http-runtime",
  "version": "0.1.33",
  "kind": "runtime",
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "validators.http",
      "runtime.http-client"
    ],
    "requires": []
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/providers/HttpValidatorsServiceProvider.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/HttpValidatorsServiceProvider.js",
          "export": "HttpValidatorsServiceProvider"
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
          "entrypoint": "src/client/providers/HttpValidatorsClientProvider.js",
          "export": "HttpValidatorsClientProvider"
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
          "summary": "Exports service providers only (HttpValidatorsServiceProvider, HttpClientRuntimeServiceProvider)."
        },
        {
          "subpath": "./shared",
          "summary": "Exports HTTP validator/schema utilities, with structured validator subpaths under ./shared/validators/*."
        }
      ],
      "containerTokens": {
        "server": [
          "runtime.http-client"
        ],
        "client": [
          "runtime.http-client.client"
        ]
      }
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/kernel": "0.1.34",
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
