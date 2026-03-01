export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/console-errors-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/observability-core",
    "@jskit-ai/support-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "workspace.console-errors.server-routes"
    ],
    "requires": [
      "contracts.http",
      "runtime.server",
      "observability.core"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providerExport": "ConsoleErrorsRouteServiceProvider"
    }
  },
  "metadata": {
    "server": {
      "routes": [
        {
          "method": "GET",
          "path": "/api/console/errors/browser",
          "summary": "List browser error logs"
        },
        {
          "method": "POST",
          "path": "/api/console/errors/browser",
          "summary": "Record browser-side JavaScript error"
        },
        {
          "method": "GET",
          "path": "/api/console/errors/browser/:errorId",
          "summary": "Get browser error log entry by id"
        },
        {
          "method": "GET",
          "path": "/api/console/errors/server",
          "summary": "List server error logs"
        },
        {
          "method": "GET",
          "path": "/api/console/errors/server/:errorId",
          "summary": "Get server error log entry by id"
        },
        {
          "method": "POST",
          "path": "/api/console/simulate/server-error",
          "summary": "Simulate a server error for diagnostics"
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
        "@jskit-ai/http-contracts": "0.1.0",
        "@jskit-ai/support-core": "0.1.0"
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
