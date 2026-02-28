export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/console-errors-client-runtime",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/observability-core",
    "@jskit-ai/web-runtime-core",
    "@jskit-ai/http-client-runtime",
    "@jskit-ai/surface-routing"
  ],
  "capabilities": {
    "provides": [],
    "requires": [
      "observability.core",
      "runtime.http-client",
      "runtime.web"
    ]
  },
  "metadata": {
    "server": {
      "routes": []
    },
    "ui": {
      "routes": [],
      "elements": []
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/observability-core": "0.1.0",
        "@jskit-ai/web-runtime-core": "0.1.0",
        "@jskit-ai/http-client-runtime": "0.1.0",
        "@jskit-ai/surface-routing": "0.1.0",
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
