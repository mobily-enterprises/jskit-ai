export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/realtime",
  version: "0.1.44",
  kind: "runtime",
  description: "Thin, generic realtime runtime wrappers for socket.io server and client.",
  options: {
    "realtime-redis-url": {
      required: true,
      allowEmpty: true,
      values: [],
      defaultValue: "",
      promptLabel: "Realtime Redis URL",
      promptHint: "Leave empty to use in-memory socket adapter."
    }
  },
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "runtime.realtime",
      "runtime.realtime.client"
    ],
    requires: []
  },
  runtime: {
    server: {
      providerEntrypoint: "src/server/RealtimeServiceProvider.js",
      providers: [
        {
          entrypoint: "src/server/RealtimeServiceProvider.js",
          export: "RealtimeServiceProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/RealtimeClientProvider.js",
          export: "RealtimeClientProvider"
        }
      ]
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server",
          summary: "Exports RealtimeServiceProvider only."
        },
        {
          subpath: "./client",
          summary: "Exports RealtimeClientProvider only."
        },
        {
          subpath: "./client/listeners",
          summary: "Exports client listener registration helpers for provider-level realtime subscriptions."
        },
        {
          subpath: "./client/composables/*",
          summary: "Exports component-level realtime socket composables."
        }
      ],
      containerTokens: {
        server: [
          "runtime.realtime",
          "runtime.realtime.io"
        ],
        client: [
          "runtime.realtime.client",
          "runtime.realtime.client.socket",
          "realtime.web.connection.indicator"
        ]
      }
    },
    ui: {
      placements: {
        outlets: [],
        contributions: [
          {
            id: "realtime.connection.indicator",
            target: "shell-layout:top-right",
            surfaces: ["*"],
            order: 950,
            componentToken: "realtime.web.connection.indicator",
            source: "mutations.text#realtime-placement-indicator"
          }
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.45",
        "@socket.io/redis-adapter": "^8.3.0",
        "redis": "^5.8.2",
        "socket.io": "^4.8.3",
        "socket.io-client": "^4.8.3"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    vite: {
      proxy: [
        {
          id: "realtime-socket-io",
          path: "/socket.io",
          changeOrigin: true,
          ws: true
        }
      ]
    },
    text: [
      {
        file: ".env",
        op: "upsert-env",
        key: "REALTIME_REDIS_URL",
        value: "${option:realtime-redis-url}",
        reason: "Configure optional Redis backplane URL for realtime socket adapter.",
        category: "runtime-config",
        id: "realtime-redis-url"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"realtime.connection.indicator\"",
        value:
          "\naddPlacement({\n  id: \"realtime.connection.indicator\",\n  target: \"shell-layout:top-right\",\n  surfaces: [\"*\"],\n  order: 950,\n  componentToken: \"realtime.web.connection.indicator\"\n});\n",
        reason: "Append realtime connection indicator placement into app-owned placement registry.",
        category: "realtime-web",
        id: "realtime-placement-indicator"
      }
    ]
  }
});
