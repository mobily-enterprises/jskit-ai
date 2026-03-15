export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/realtime",
  version: "0.1.0",
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
        }
      ],
      containerTokens: {
        server: [
          "runtime.realtime"
        ],
        client: [
          "runtime.realtime.client"
        ]
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/kernel": "0.1.0",
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
    text: [
      {
        file: ".env",
        op: "upsert-env",
        key: "REALTIME_REDIS_URL",
        value: "${option:realtime-redis-url}",
        reason: "Configure optional Redis backplane URL for realtime socket adapter.",
        category: "runtime-config",
        id: "realtime-redis-url"
      }
    ]
  }
});
