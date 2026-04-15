export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/console-web",
  version: "0.1.2",
  kind: "runtime",
  description: "Authenticated console surface scaffold and surface policy wiring.",
  dependsOn: [
    "@jskit-ai/auth-web",
    "@jskit-ai/shell-web",
    "@jskit-ai/users-core"
  ],
  capabilities: {
    provides: [
      "console.web"
    ],
    requires: [
      "users.core"
    ]
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports no runtime API today (reserved console surface package entrypoint)."
        }
      ],
      containerTokens: {
        server: [],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-web": "0.1.36",
        "@jskit-ai/shell-web": "0.1.34",
        "@jskit-ai/users-core": "0.1.45"
      },
      dev: {}
    },
    packageJson: {
      scripts: {
        "server:console": "SERVER_SURFACE=console node ./bin/server.js",
        "dev:console": "VITE_SURFACE=console vite",
        "build:console": "VITE_SURFACE=console vite build"
      }
    },
    procfile: {},
    files: [
      {
        from: "templates/src/pages/console.vue",
        toSurface: "console",
        toSurfaceRoot: true,
        ownership: "app",
        reason: "Install shell-driven console wrapper page.",
        category: "console-web",
        id: "console-web-page-console-wrapper"
      },
      {
        from: "templates/src/pages/console/index.vue",
        toSurface: "console",
        toSurfacePath: "index.vue",
        ownership: "app",
        reason: "Install shell-driven console page starter.",
        category: "console-web",
        id: "console-web-page-console"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "config/surfaceAccessPolicies.js",
        position: "bottom",
        skipIfContains: "surfaceAccessPolicies.console_owner = {",
        value: "\nsurfaceAccessPolicies.console_owner = {\n  requireAuth: true,\n  requireFlagsAll: [\"console_owner\"]\n};\n",
        reason: "Register console-owner surface access policy for the console surface.",
        category: "console-web",
        id: "console-web-surface-access-policies-console-owner"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.surfaceDefinitions.console = {",
        value:
          "\nconfig.surfaceDefinitions.console = {\n  id: \"console\",\n  label: \"Console\",\n  pagesRoot: \"console\",\n  enabled: true,\n  requiresAuth: true,\n  requiresWorkspace: false,\n  accessPolicyId: \"console_owner\",\n  origin: \"\"\n};\n",
        reason: "Register console surface definition once console-web is installed.",
        category: "console-web",
        id: "console-web-surface-config-console"
      }
    ]
  }
});
