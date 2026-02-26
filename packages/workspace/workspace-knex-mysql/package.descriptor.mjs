export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/knex-mysql-core",
    "@jskit-ai/access-core"
  ],
  "capabilities": {
    "provides": [
      "workspace.store.mysql"
    ],
    "requires": [
      "workspace.console.core",
      "db-provider",
      "auth.access"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/knex-mysql-core": "0.1.0",
        "@jskit-ai/workspace-console-core": "0.1.0"
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
