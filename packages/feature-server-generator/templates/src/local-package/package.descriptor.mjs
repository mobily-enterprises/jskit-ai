export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/${option:feature-name|kebab}",
  version: "0.1.0",
  kind: "runtime",
  description: "App-local non-CRUD feature package (${option:feature-name|kebab}).",
  dependsOn: [
    "@jskit-ai/kernel"__JSKIT_FEATURE_DESCRIPTOR_DEPENDS_ON_LINES__
  ],
  capabilities: {
    provides: [
      "feature.${option:feature-name|kebab}"
    ],
    requires: [
      "runtime.actions"__JSKIT_FEATURE_DESCRIPTOR_CAPABILITY_REQUIRES_LINES__
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/${option:feature-name|pascal}Provider.js",
          export: "${option:feature-name|pascal}Provider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/actions",
          summary: "Exports generated feature action definitions with inline starter ids."
        }
      ],
      containerTokens: {
        server: [
          "feature.${option:feature-name|kebab}.service"__JSKIT_FEATURE_DESCRIPTOR_REPOSITORY_TOKEN_LINE__
        ],
        client: []
      }
    },
    jskit: {
      scaffoldShape: "feature-server-v1",
      scaffoldMode: "${option:mode}",
      lane: "__JSKIT_FEATURE_DESCRIPTOR_LANE__"
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: []
  }
});
