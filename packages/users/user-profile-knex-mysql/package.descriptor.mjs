export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/user-profile-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/knex-mysql-core",
    "@jskit-ai/user-profile-core"
  ],
  "capabilities": {
    "provides": [
      "users.profile.store.mysql"
    ],
    "requires": [
      "db-provider",
      "users.profile.core"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/knex-mysql-core": "0.1.0"
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
