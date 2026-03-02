export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/http-client-runtime",
  "version": "0.1.0",
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "runtime.http-client"
    ],
    "requires": []
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/HttpClientRuntimeServiceProvider.js",
          "export": "HttpClientRuntimeServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
        {
          "entrypoint": "src/client/providers/HttpClientRuntimeClientProvider.js",
          "export": "HttpClientRuntimeClientProvider"
        }
      ]
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {},
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
