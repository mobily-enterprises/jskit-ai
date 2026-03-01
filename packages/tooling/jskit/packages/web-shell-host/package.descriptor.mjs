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
        "@jskit-ai/web-runtime-core": "0.1.0",
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
        dev: "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.js vite",
        "dev:app": "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.app.js vite",
        "dev:admin": "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.admin.js vite",
        "dev:console": "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.console.js vite",
        build: "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.app.js vite build --outDir dist/app",
        "build:admin":
          "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.admin.js vite build --outDir dist/admin",
        "build:console":
          "npm run web-shell:generate && VITE_CLIENT_ENTRY=surface.console.js vite build --outDir dist/console"
      }
    },
    procfile: {},
    files: [
      {
        from: "templates/src/surface.js",
        to: "src/surface.js",
        reason: "Bootstrap filesystem-driven shell runtime entrypoint.",
        category: "web-shell",
        id: "main-web-shell"
      },
      {
        from: "templates/src/surface.app.js",
        to: "src/surface.app.js",
        reason: "Bootstrap app surface web-shell entrypoint.",
        category: "web-shell",
        id: "main-web-shell-app"
      },
      {
        from: "templates/src/surface.admin.js",
        to: "src/surface.admin.js",
        reason: "Bootstrap admin surface web-shell entrypoint.",
        category: "web-shell",
        id: "main-web-shell-admin"
      },
      {
        from: "templates/src/surface.console.js",
        to: "src/surface.console.js",
        reason: "Bootstrap console surface web-shell entrypoint.",
        category: "web-shell",
        id: "main-web-shell-console"
      },
      {
        from: "templates/src/runtime/filesystemHost.js",
        to: "src/runtime/filesystemHost.js",
        reason: "Provide host-side composition primitives for shell surfaces.",
        category: "web-shell",
        id: "filesystem-host"
      },
      {
        from: "templates/src/runtime/surfaces.js",
        to: "src/runtime/surfaces.js",
        reason: "Define shared surface registry for entrypoints and route generation.",
        category: "web-shell",
        id: "surface-registry"
      },
      {
        from: "templates/src/runtime/filesystemHost.app.js",
        to: "src/runtime/filesystemHost.app.js",
        reason: "Provide app surface filesystem host bindings.",
        category: "web-shell",
        id: "filesystem-host-app"
      },
      {
        from: "templates/src/runtime/filesystemHost.admin.js",
        to: "src/runtime/filesystemHost.admin.js",
        reason: "Provide admin surface filesystem host bindings.",
        category: "web-shell",
        id: "filesystem-host-admin"
      },
      {
        from: "templates/src/runtime/filesystemHost.console.js",
        to: "src/runtime/filesystemHost.console.js",
        reason: "Provide console surface filesystem host bindings.",
        category: "web-shell",
        id: "filesystem-host-console"
      },
      {
        from: "templates/src/runtime/generated/filesystemManifest.generated.js",
        to: "src/runtime/generated/filesystemManifest.generated.js",
        reason: "Seed generated manifest module for initial build.",
        category: "web-shell",
        id: "filesystem-manifest-generated"
      },
      {
        from: "templates/src/runtime/generated/filesystemManifest.app.generated.js",
        to: "src/runtime/generated/filesystemManifest.app.generated.js",
        reason: "Seed generated app manifest module for initial build.",
        category: "web-shell",
        id: "filesystem-manifest-app-generated"
      },
      {
        from: "templates/src/runtime/generated/filesystemManifest.admin.generated.js",
        to: "src/runtime/generated/filesystemManifest.admin.generated.js",
        reason: "Seed generated admin manifest module for initial build.",
        category: "web-shell",
        id: "filesystem-manifest-admin-generated"
      },
      {
        from: "templates/src/runtime/generated/filesystemManifest.console.generated.js",
        to: "src/runtime/generated/filesystemManifest.console.generated.js",
        reason: "Seed generated console manifest module for initial build.",
        category: "web-shell",
        id: "filesystem-manifest-console-generated"
      },
      {
        from: "templates/src/runtime/createWebShellApp.js",
        to: "src/runtime/createWebShellApp.js",
        reason: "Provide shared app bootstrapping for web shell entrypoints.",
        category: "web-shell",
        id: "web-shell-app-bootstrap"
      },
      {
        from: "templates/src/runtime/router.js",
        to: "src/runtime/router.js",
        reason: "Configure TanStack router from filesystem manifest entries.",
        category: "web-shell",
        id: "router"
      },
      {
        from: "templates/src/runtime/guardRuntime.js",
        to: "src/runtime/guardRuntime.js",
        reason: "Provide guard policy runtime for shell route composition.",
        category: "web-shell",
        id: "guard-runtime"
      },
      {
        from: "templates/src/runtime/useShellHost.js",
        to: "src/runtime/useShellHost.js",
        reason: "Provide editable shell host composition logic.",
        category: "web-shell",
        id: "shell-host-runtime"
      },
      {
        from: "templates/src/runtime/useShellContext.js",
        to: "src/runtime/useShellContext.js",
        reason: "Provide shell context and workspace/user state helpers.",
        category: "web-shell",
        id: "shell-context"
      },
      {
        from: "templates/src/runtime/GlobalNetworkActivityBar.vue",
        to: "src/runtime/GlobalNetworkActivityBar.vue",
        reason: "Provide global network activity indicator.",
        category: "web-shell",
        id: "shell-network-activity"
      },
      {
        from: "templates/src/layout.app.vue",
        to: "src/layout.app.vue",
        reason: "Install app surface shell layout scaffold.",
        category: "web-shell",
        id: "shell-app"
      },
      {
        from: "templates/src/layout.admin.vue",
        to: "src/layout.admin.vue",
        reason: "Install admin surface shell layout scaffold.",
        category: "web-shell",
        id: "shell-admin"
      },
      {
        from: "templates/src/layout.console.vue",
        to: "src/layout.console.vue",
        reason: "Install console surface shell layout scaffold.",
        category: "web-shell",
        id: "shell-console"
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
