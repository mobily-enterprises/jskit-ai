export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/value-app-config-shared",
  version: "0.1.0",
  description: "Scaffold value-app style shared and config defaults required by server modules.",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/action-runtime-core": "0.1.0",
        "@jskit-ai/realtime-contracts": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/surface-routing": "0.1.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    text: [],
    files: [
      {
        from: "templates/config/index.js",
        to: "config/index.js",
        reason: "Provide canonical repository config assembly and validation defaults.",
        category: "app-config",
        id: "config-index"
      },
      {
        from: "templates/config/app.js",
        to: "config/app.js",
        reason: "Provide app policy defaults.",
        category: "app-config",
        id: "config-app"
      },
      {
        from: "templates/config/chat.js",
        to: "config/chat.js",
        reason: "Provide chat policy defaults.",
        category: "app-config",
        id: "config-chat"
      },
      {
        from: "templates/config/social.js",
        to: "config/social.js",
        reason: "Provide social policy defaults.",
        category: "app-config",
        id: "config-social"
      },
      {
        from: "templates/config/ai.js",
        to: "config/ai.js",
        reason: "Provide AI policy defaults.",
        category: "app-config",
        id: "config-ai"
      },
      {
        from: "templates/config/billing.js",
        to: "config/billing.js",
        reason: "Provide billing policy defaults.",
        category: "app-config",
        id: "config-billing"
      },
      {
        from: "templates/config/retention.js",
        to: "config/retention.js",
        reason: "Provide retention policy defaults.",
        category: "app-config",
        id: "config-retention"
      },
      {
        from: "templates/config/actions.js",
        to: "config/actions.js",
        reason: "Provide action exposure policy defaults.",
        category: "app-config",
        id: "config-actions"
      },
      {
        from: "templates/config/urls.js",
        to: "config/urls.js",
        reason: "Provide URL mount override defaults.",
        category: "app-config",
        id: "config-urls"
      },
      {
        from: "templates/config/lib/helpers.js",
        to: "config/lib/helpers.js",
        reason: "Provide config validation helper primitives.",
        category: "app-config",
        id: "config-helpers"
      },
      {
        from: "templates/shared/apiPaths.js",
        to: "shared/apiPaths.js",
        reason: "Provide shared API path contract facade.",
        category: "app-shared",
        id: "shared-api-paths"
      },
      {
        from: "templates/shared/surfacePaths.js",
        to: "shared/surfacePaths.js",
        reason: "Provide shared surface path contract facade.",
        category: "app-shared",
        id: "shared-surface-paths"
      },
      {
        from: "templates/shared/surfaceRegistry.js",
        to: "shared/surfaceRegistry.js",
        reason: "Provide shared surface registry contract facade.",
        category: "app-shared",
        id: "shared-surface-registry"
      },
      {
        from: "templates/shared/topicRegistry.js",
        to: "shared/topicRegistry.js",
        reason: "Provide shared realtime topic contract facade.",
        category: "app-shared",
        id: "shared-topic-registry"
      },
      {
        from: "templates/shared/actionIds.js",
        to: "shared/actionIds.js",
        reason: "Provide shared action id contract facade.",
        category: "app-shared",
        id: "shared-action-ids"
      },
      {
        from: "templates/shared/eventTypes.js",
        to: "shared/eventTypes.js",
        reason: "Provide shared realtime event type contract facade.",
        category: "app-shared",
        id: "shared-event-types"
      },
      {
        from: "templates/shared/avatar.js",
        to: "shared/avatar.js",
        reason: "Provide shared avatar policy constants.",
        category: "app-shared",
        id: "shared-avatar"
      },
      {
        from: "templates/shared/alerts/targetUrl.js",
        to: "shared/alerts/targetUrl.js",
        reason: "Provide shared alert target URL normalization utilities.",
        category: "app-shared",
        id: "shared-alert-target-url"
      },
      {
        from: "templates/shared/framework/capabilities.js",
        to: "shared/framework/capabilities.js",
        reason: "Provide framework capability contract helpers.",
        category: "app-shared",
        id: "shared-framework-capabilities"
      },
      {
        from: "templates/shared/framework/profile.js",
        to: "shared/framework/profile.js",
        reason: "Provide framework module profile defaults.",
        category: "app-shared",
        id: "shared-framework-profile"
      },
      {
        from: "templates/server/shared/resolveRequestSurface.js",
        to: "server/shared/resolveRequestSurface.js",
        reason: "Provide server helper for resolving request surface context.",
        category: "server-shared",
        id: "server-shared-resolve-request-surface"
      },
      {
        from: "templates/server/shared/scopedServiceOptions.js",
        to: "server/shared/scopedServiceOptions.js",
        reason: "Provide server helper for scoped service option bags.",
        category: "server-shared",
        id: "server-shared-scoped-service-options"
      }
    ]
  }
});
