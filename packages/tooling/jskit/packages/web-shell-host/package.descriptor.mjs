export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/web-shell-host",
  version: "0.1.0",
  description: "Scaffolds filesystem-driven web shell host (drawer/top/config + route composition).",
  dependsOn: [],
  capabilities: {
    provides: ["runtime.web-shell-host"],
    requires: ["runtime.web"]
  },
  metadata: {
    server: {
      routes: []
    },
    ui: {
      routes: [
        {
          path: "/app",
          surface: "app",
          name: "app-home",
          purpose: "Default app surface route."
        },
        {
          path: "/app/settings",
          surface: "app",
          name: "app-settings",
          purpose: "Default app settings route."
        },
        {
          path: "/admin",
          surface: "admin",
          name: "admin-home",
          purpose: "Default admin surface route."
        },
        {
          path: "/admin/settings",
          surface: "admin",
          name: "admin-settings",
          purpose: "Default admin settings route."
        },
        {
          path: "/console",
          surface: "console",
          name: "console-home",
          purpose: "Default console surface route."
        }
      ],
      elements: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@mdi/js": "^7.4.47",
        "@tanstack/vue-query": "^5.90.5",
        "@tanstack/vue-router": "^1.159.10",
        "vuetify": "^3.7.5"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "web-shell:generate": "node ./scripts/web-shell/generate-filesystem-manifest.mjs",
        dev: "npm run web-shell:generate && VITE_CLIENT_ENTRY=main.web-shell.js vite",
        build: "npm run web-shell:generate && VITE_CLIENT_ENTRY=main.web-shell.js vite build",
        "build:client:internal":
          "npm run web-shell:generate && VITE_CLIENT_ENTRY=main.web-shell.js vite build --outDir dist-internal"
      }
    },
    procfile: {},
    files: [
      {
        from: "templates/src/main.web-shell.js",
        to: "src/main.web-shell.js",
        reason: "Bootstrap filesystem-driven shell runtime entrypoint.",
        category: "web-shell",
        id: "main-web-shell"
      },
      {
        from: "templates/src/shell/filesystemHost.js",
        to: "src/shell/filesystemHost.js",
        reason: "Provide host-side composition primitives for shell surfaces.",
        category: "web-shell",
        id: "filesystem-host"
      },
      {
        from: "templates/src/shell/generated/filesystemManifest.generated.js",
        to: "src/shell/generated/filesystemManifest.generated.js",
        reason: "Seed generated manifest module for initial build.",
        category: "web-shell",
        id: "filesystem-manifest-generated"
      },
      {
        from: "templates/src/shell/router.js",
        to: "src/shell/router.js",
        reason: "Configure TanStack router from filesystem manifest entries.",
        category: "web-shell",
        id: "router"
      },
      {
        from: "templates/src/shell/guardRuntime.js",
        to: "src/shell/guardRuntime.js",
        reason: "Provide guard policy runtime for shell route composition.",
        category: "web-shell",
        id: "guard-runtime"
      },
      {
        from: "templates/src/shell/ShellHost.vue",
        to: "src/shell/ShellHost.vue",
        reason: "Install shell host UI scaffold with drawer/top/config regions.",
        category: "web-shell",
        id: "shell-host-vue"
      },
      {
        from: "templates/src/pages/app/index.vue",
        to: "src/pages/app/index.vue",
        reason: "Provide default app surface home page.",
        category: "web-shell",
        id: "page-app-index"
      },
      {
        from: "templates/src/pages/app/settings.vue",
        to: "src/pages/app/settings.vue",
        reason: "Provide default app surface settings page.",
        category: "web-shell",
        id: "page-app-settings"
      },
      {
        from: "templates/src/pages/admin/index.vue",
        to: "src/pages/admin/index.vue",
        reason: "Provide default admin surface dashboard page.",
        category: "web-shell",
        id: "page-admin-index"
      },
      {
        from: "templates/src/pages/admin/settings.vue",
        to: "src/pages/admin/settings.vue",
        reason: "Provide default admin surface settings page.",
        category: "web-shell",
        id: "page-admin-settings"
      },
      {
        from: "templates/src/pages/console/index.vue",
        to: "src/pages/console/index.vue",
        reason: "Provide default console surface landing page.",
        category: "web-shell",
        id: "page-console-index"
      },
      {
        from: "templates/src/surfaces/app/drawer/home.entry.js",
        to: "src/surfaces/app/drawer.d/home.entry.js",
        reason: "Seed app drawer navigation entry.",
        category: "web-shell-surface",
        id: "surface-app-drawer-home"
      },
      {
        from: "templates/src/surfaces/app/top/settings.entry.js",
        to: "src/surfaces/app/top.d/settings.entry.js",
        reason: "Seed app top navigation entry.",
        category: "web-shell-surface",
        id: "surface-app-top-settings"
      },
      {
        from: "templates/src/surfaces/admin/drawer/dashboard.entry.js",
        to: "src/surfaces/admin/drawer.d/dashboard.entry.js",
        reason: "Seed admin drawer navigation entry.",
        category: "web-shell-surface",
        id: "surface-admin-drawer-dashboard"
      },
      {
        from: "templates/src/surfaces/admin/top/settings.entry.js",
        to: "src/surfaces/admin/top.d/settings.entry.js",
        reason: "Seed admin top navigation entry.",
        category: "web-shell-surface",
        id: "surface-admin-top-settings"
      },
      {
        from: "templates/src/surfaces/admin/config/workspace.entry.js",
        to: "src/surfaces/admin/config.d/workspace.entry.js",
        reason: "Seed admin config-panel entry.",
        category: "web-shell-surface",
        id: "surface-admin-config-workspace"
      },
      {
        from: "templates/src/surfaces/console/drawer/overview.entry.js",
        to: "src/surfaces/console/drawer.d/overview.entry.js",
        reason: "Seed console drawer navigation entry.",
        category: "web-shell-surface",
        id: "surface-console-drawer-overview"
      },
      {
        from: "templates/scripts/web-shell/generate-filesystem-manifest.mjs",
        to: "scripts/web-shell/generate-filesystem-manifest.mjs",
        reason: "Install manifest generator for filesystem-driven routing and surfaces.",
        category: "web-shell",
        id: "web-shell-generate-script"
      }
    ]
  }
});
