export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/rbac-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/access-core"
  ],
  "capabilities": {
    "provides": [
      "auth.rbac"
    ],
    "requires": [
      "auth.access"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/RbacServiceProvider.js",
          "export": "RbacServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
        {
          "entrypoint": "src/client/providers/RbacClientProvider.js",
          "export": "RbacClientProvider"
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
