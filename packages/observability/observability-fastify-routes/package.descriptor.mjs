export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/observability-fastify-routes",
  "version": "0.1.0",
  "description": "Fastify metrics endpoint routes/controller/schema for observability.",
  "dependsOn": [
    "@jskit-ai/observability-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "observability.server-routes"
    ],
    "requires": [
      "observability.core",
      "contracts.http",
      "runtime.server"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providerExport": "ObservabilityRouteServiceProvider"
    }
  },
  "metadata": {
    "server": {
      "routes": [
        {
          "method": "GET",
          "path": "/api/metrics",
          "summary": "Prometheus metrics endpoint"
        }
      ]
    },
    "ui": {
      "elements": []
    }
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
