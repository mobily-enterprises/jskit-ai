export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/web-shell-host",
  version: "0.1.0",
  description: "Scaffolds filesystem-driven web shell host (drawer/top/config + route composition).",
  dependsOn: [],
  capabilities: {
    provides: ["runtime.web", "runtime.web-shell-host"],
    requires: []
  },
  mutations: {
    dependencies: {
      runtime: {
        "@tanstack/vue-router": "^1.159.10"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "web-shell:generate": "node ./scripts/web-shell/generate-filesystem-manifest.mjs",
        dev: "npm run web-shell:generate && VITE_CLIENT_ENTRY=main.web-shell.js jskit-app-scripts dev",
        build: "npm run web-shell:generate && VITE_CLIENT_ENTRY=main.web-shell.js jskit-app-scripts build",
        "build:client:internal":
          "npm run web-shell:generate && VITE_CLIENT_ENTRY=main.web-shell.js jskit-app-scripts build:client:internal"
      }
    },
    procfile: {},
    files: [
      {
        from: "templates/src/main.web-shell.js",
        to: "src/main.web-shell.js"
      },
      {
        from: "templates/src/shell/filesystemHost.js",
        to: "src/shell/filesystemHost.js"
      },
      {
        from: "templates/src/shell/generated/filesystemManifest.generated.js",
        to: "src/shell/generated/filesystemManifest.generated.js"
      },
      {
        from: "templates/src/shell/router.js",
        to: "src/shell/router.js"
      },
      {
        from: "templates/src/shell/guardRuntime.js",
        to: "src/shell/guardRuntime.js"
      },
      {
        from: "templates/src/shell/ShellHost.vue",
        to: "src/shell/ShellHost.vue"
      },
      {
        from: "templates/src/pages/app/index.vue",
        to: "src/pages/app/index.vue"
      },
      {
        from: "templates/src/pages/app/settings.vue",
        to: "src/pages/app/settings.vue"
      },
      {
        from: "templates/src/pages/admin/index.vue",
        to: "src/pages/admin/index.vue"
      },
      {
        from: "templates/src/pages/admin/settings.vue",
        to: "src/pages/admin/settings.vue"
      },
      {
        from: "templates/src/pages/console/index.vue",
        to: "src/pages/console/index.vue"
      },
      {
        from: "templates/src/surfaces/app/drawer/home.entry.js",
        to: "src/surfaces/app/drawer/home.entry.js"
      },
      {
        from: "templates/src/surfaces/app/top/settings.entry.js",
        to: "src/surfaces/app/top/settings.entry.js"
      },
      {
        from: "templates/src/surfaces/admin/drawer/dashboard.entry.js",
        to: "src/surfaces/admin/drawer/dashboard.entry.js"
      },
      {
        from: "templates/src/surfaces/admin/top/settings.entry.js",
        to: "src/surfaces/admin/top/settings.entry.js"
      },
      {
        from: "templates/src/surfaces/admin/config/workspace.entry.js",
        to: "src/surfaces/admin/config/workspace.entry.js"
      },
      {
        from: "templates/src/surfaces/console/drawer/overview.entry.js",
        to: "src/surfaces/console/drawer/overview.entry.js"
      },
      {
        from: "templates/scripts/web-shell/generate-filesystem-manifest.mjs",
        to: "scripts/web-shell/generate-filesystem-manifest.mjs"
      }
    ]
  }
});
