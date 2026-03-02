export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/social-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/action-runtime-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/social-contracts",
    "@jskit-ai/jskit-knex"
  ],
  "capabilities": {
    "provides": [
      "social.core",
      "social.storage"
    ],
    "requires": [
      "runtime.actions",
      "runtime.server",
      "contracts.social",
      "db.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/action-runtime-core": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/jskit-knex": "0.1.0"
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
