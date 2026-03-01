export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/settings-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/auth-fastify-routes",
    "@jskit-ai/http-contracts",
    "@jskit-ai/server-runtime-core",
    "@jskit-ai/support-core",
    "@jskit-ai/workspace-console-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "workspace.settings.server-routes"
    ],
    "requires": [
      "auth.access",
      "auth.server-routes",
      "contracts.http",
      "runtime.server",
      "workspace.console.core"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providerExport": "SettingsRouteServiceProvider"
    }
  },
  "metadata": {
    "server": {
      "routes": [
        {
          "method": "GET",
          "path": "/api/settings",
          "summary": ""
        },
        {
          "method": "PATCH",
          "path": "/api/settings/chat",
          "summary": "Update chat settings"
        },
        {
          "method": "PATCH",
          "path": "/api/settings/notifications",
          "summary": "Update notification settings"
        },
        {
          "method": "PATCH",
          "path": "/api/settings/preferences",
          "summary": "Update user preferences"
        },
        {
          "method": "PATCH",
          "path": "/api/settings/profile",
          "summary": "Update profile settings"
        },
        {
          "method": "DELETE",
          "path": "/api/settings/profile/avatar",
          "summary": "Delete profile avatar and fallback to gravatar"
        },
        {
          "method": "POST",
          "path": "/api/settings/profile/avatar",
          "summary": "Upload profile avatar"
        },
        {
          "method": "POST",
          "path": "/api/settings/security/change-password",
          "summary": ""
        },
        {
          "method": "POST",
          "path": "/api/settings/security/logout-others",
          "summary": "Sign out from other active sessions"
        },
        {
          "method": "PATCH",
          "path": "/api/settings/security/methods/password",
          "summary": "Enable or disable password sign-in method"
        },
        {
          "method": "DELETE",
          "path": "/api/settings/security/oauth/:provider",
          "summary": "Unlink an OAuth provider from authenticated account"
        },
        {
          "method": "GET",
          "path": "/api/settings/security/oauth/:provider/start",
          "summary": "Start linking an OAuth provider for authenticated user"
        }
      ]
    },
    "ui": {
      "elements": []
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/auth-fastify-routes": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@jskit-ai/support-core": "0.1.0",
        "@jskit-ai/workspace-console-core": "0.1.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
