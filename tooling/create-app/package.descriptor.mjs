export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/create-app",
  "version": "0.1.24",
  "dependsOn": [],
  "capabilities": {
    "provides": [
      "tooling.create-app"
    ],
    "requires": []
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
    "files": [
      {
        "from": "templates/base-shell/bin/server.js",
        "to": "base-shell/bin/server.js"
      },
      {
        "from": "templates/base-shell/eslint.config.mjs",
        "to": "base-shell/eslint.config.mjs"
      },
      {
        "from": "templates/base-shell/favicon.svg",
        "to": "base-shell/favicon.svg"
      },
      {
        "from": "templates/base-shell/gitignore",
        "to": "base-shell/gitignore"
      },
      {
        "from": "templates/base-shell/index.html",
        "to": "base-shell/index.html"
      },
      {
        "from": "templates/base-shell/package.json",
        "to": "base-shell/package.json"
      },
      {
        "from": "templates/base-shell/Procfile",
        "to": "base-shell/Procfile"
      },
      {
        "from": "templates/base-shell/README.md",
        "to": "base-shell/README.md"
      },
      {
        "from": "templates/base-shell/server.js",
        "to": "base-shell/server.js"
      },
      {
        "from": "templates/base-shell/server/lib/runtimeEnv.js",
        "to": "base-shell/server/lib/runtimeEnv.js"
      },
      {
        "from": "templates/base-shell/src/main.js",
        "to": "base-shell/src/main.js"
      },
      {
        "from": "templates/base-shell/src/App.vue",
        "to": "base-shell/src/App.vue"
      },
      {
        "from": "templates/base-shell/src/pages/home.vue",
        "to": "base-shell/src/pages/home.vue"
      },
      {
        "from": "templates/base-shell/src/pages/home/index.vue",
        "to": "base-shell/src/pages/home/index.vue"
      },
      {
        "from": "templates/base-shell/tests/client/smoke.vitest.js",
        "to": "base-shell/tests/client/smoke.vitest.js"
      },
      {
        "from": "templates/base-shell/tests/server/minimalShell.validator.test.js",
        "to": "base-shell/tests/server/minimalShell.validator.test.js"
      },
      {
        "from": "templates/base-shell/tests/server/smoke.test.js",
        "to": "base-shell/tests/server/smoke.test.js"
      },
      {
        "from": "templates/base-shell/vite.config.mjs",
        "to": "base-shell/vite.config.mjs"
      }
    ]
  }
});
