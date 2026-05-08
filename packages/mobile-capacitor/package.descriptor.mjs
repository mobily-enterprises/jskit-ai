export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/mobile-capacitor",
  version: "0.1.3",
  kind: "runtime",
  description: "Thin Capacitor client integration for JSKIT mobile-shell launch routing and auth callback completion.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@jskit-ai/shell-web"
  ],
  capabilities: {
    provides: ["mobile.capacitor"],
    requires: []
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/MobileCapacitorClientProvider.js",
          export: "MobileCapacitorClientProvider"
        }
      ]
    }
  },
  lifecycle: {
    install: {
      prepare: {
        entrypoint: "src/server/buildTemplateContext.js",
        export: "prepareInstallHook"
      },
      finalize: {
        entrypoint: "src/server/buildTemplateContext.js",
        export: "finalizeInstallHook",
        managesNpmInstall: true
      }
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./client",
          summary: "Exports the Capacitor client provider, launch adapter helpers, and mobile-shell runtime."
        }
      ],
      containerTokens: {
        server: [],
        client: [
          "mobile.capacitor.client.runtime",
          "mobile.capacitor.adapter.client"
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@capacitor/android": "^7.4.3",
        "@capacitor/app": "^7.1.0",
        "@capacitor/browser": "^7.0.1",
        "@capacitor/core": "^7.4.3",
        "@jskit-ai/kernel": "0.1.66",
        "@jskit-ai/shell-web": "0.1.65"
      },
      dev: {
        "@capacitor/cli": "^7.4.3"
      }
    },
    packageJson: {
      scripts: {
        "mobile:dev:android": "jskit mobile android dev",
        "mobile:devices:android": "jskit mobile android devices",
        "mobile:sync:android": "jskit mobile android sync",
        "mobile:tunnel:android": "jskit mobile android tunnel",
        "mobile:restart:android": "jskit mobile android restart",
        "mobile:run:android": "jskit mobile android run",
        "mobile:build:web": "npm run build",
        "mobile:build:android": "jskit mobile android build"
      }
    },
    procfile: {},
    vite: {
      proxy: []
    },
    text: [],
    files: [
      {
        from: "templates/capacitor.config.json",
        to: "capacitor.config.json",
        reason: "Install Capacitor shell configuration rendered from config.mobile.",
        category: "mobile-capacitor",
        id: "mobile-capacitor-config",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      },
      {
        from: "templates/mobile-capacitor.md",
        to: ".jskit/mobile-capacitor.md",
        reason: "Install managed mobile-shell notes for the Capacitor Android integration.",
        category: "mobile-capacitor",
        id: "mobile-capacitor-notes",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildTemplateContext"
        }
      }
    ]
  }
});
