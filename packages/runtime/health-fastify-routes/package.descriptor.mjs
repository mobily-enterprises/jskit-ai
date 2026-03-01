export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/health-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "runtime.health-server-routes"
    ],
    "requires": [
      "runtime.server",
      "contracts.http"
    ]
  },
  "runtime": {
    "server": {
      "entrypoint": "src/shared/server.js",
      "export": "createServerContributions"
    }
  },
  "metadata": {
    "server": {
      "routes": [
        {
          "method": "GET",
          "path": "/api/health",
          "summary": "Liveness probe for process health"
        },
        {
          "method": "GET",
          "path": "/api/ready",
          "summary": "Readiness probe for dependency health"
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
