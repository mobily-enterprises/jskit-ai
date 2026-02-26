export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/user-profile-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "users.profile.core"
    ],
    "requires": [
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/server-runtime-core": "0.1.0",
        "sharp": "^0.34.4",
        "unstorage": "^1.17.0"
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
