export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/access-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/surface-routing"
  ],
  "capabilities": {
    "provides": [
      "auth.access"
    ],
    "requires": [
      "runtime.surface-routing"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/surface-routing": "0.1.0"
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
