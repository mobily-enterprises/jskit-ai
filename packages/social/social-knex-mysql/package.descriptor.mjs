export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/social-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/knex-mysql-core",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/social-core"
  ],
  "capabilities": {
    "provides": [
      "social.storage.mysql"
    ],
    "requires": [
      "db-provider",
      "runtime.server",
      "social.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/knex-mysql-core": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0"
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
