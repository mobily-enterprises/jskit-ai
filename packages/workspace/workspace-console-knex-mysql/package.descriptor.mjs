export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/workspace-console-knex-mysql",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/knex-mysql-core",
    "@jskit-ai/access-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "workspace.console.store.mysql"
    ],
    "requires": [
      "workspace.console.core",
      "db-provider",
      "auth.access",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/access-core": "0.1.0",
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
