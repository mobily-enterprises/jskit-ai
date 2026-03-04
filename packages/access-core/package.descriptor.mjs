export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/access-core",
  "version": "0.1.0",
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "auth.access"
    ],
    "requires": []
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/AccessCoreServiceProvider.js",
          "export": "AccessCoreServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
        {
          "entrypoint": "src/client/providers/AccessCoreClientProvider.js",
          "export": "AccessCoreClientProvider"
        }
      ]
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/kernel": "0.1.0"
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
