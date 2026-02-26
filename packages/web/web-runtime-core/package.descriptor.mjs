export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/web-runtime-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/http-client-runtime",
    "@jskit-ai/surface-routing",
    "@jskit-ai/http-contracts"
  ],
  "capabilities": {
    "provides": [
      "runtime.web"
    ],
    "requires": [
      "runtime.server",
      "runtime.http-client",
      "runtime.surface-routing",
      "contracts.http"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/http-client-runtime": "0.1.0",
        "@tanstack/vue-query": "^5.90.5",
        "@tanstack/vue-router": "^1.159.10",
        "vue": "^3.5.13"
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
