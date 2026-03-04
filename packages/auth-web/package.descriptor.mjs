export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-web",
  "version": "0.1.0",
  "description": "Auth web module: Fastify auth routes plus web login/sign-out scaffolds.",
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/http-client-runtime",
    "@jskit-ai/http-contracts",
    "@jskit-ai/fastify-auth-policy",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "auth.server-routes",
      "auth.web-login"
    ],
    "requires": [
      "auth.access",
      "auth.provider",
      "contracts.http",
      "auth.policy"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/AuthWebServiceProvider.js",
          "export": "AuthWebServiceProvider"
        },
        {
          "entrypoint": "src/server/providers/AuthRouteServiceProvider.js",
          "export": "AuthRouteServiceProvider"
        }
      ]
    },
    "client": {
      "providers": [
        {
          "entrypoint": "src/client/providers/AuthWebClientProvider.js",
          "export": "AuthWebClientProvider"
        }
      ]
    }
  },
  "metadata": {
    "server": {
      "routes": [
        {
          "method": "POST",
          "path": "/api/login",
          "summary": "Log in with configured credentials"
        },
        {
          "method": "POST",
          "path": "/api/login/otp/request",
          "summary": "Request one-time email login code"
        },
        {
          "method": "POST",
          "path": "/api/login/otp/verify",
          "summary": "Verify one-time email login code and create session"
        },
        {
          "method": "POST",
          "path": "/api/logout",
          "summary": "Log out and clear session cookies"
        },
        {
          "method": "GET",
          "path": "/api/oauth/:provider/start",
          "summary": "Start OAuth login with configured provider"
        },
        {
          "method": "POST",
          "path": "/api/oauth/complete",
          "summary": "Complete OAuth code exchange and set session cookies"
        },
        {
          "method": "POST",
          "path": "/api/password/forgot",
          "summary": "Request a password reset email"
        },
        {
          "method": "POST",
          "path": "/api/password/recovery",
          "summary": "Complete password recovery link exchange"
        },
        {
          "method": "POST",
          "path": "/api/password/reset",
          "summary": "Set a new password for authenticated recovery session"
        },
        {
          "method": "POST",
          "path": "/api/register",
          "summary": "Register a new user"
        },
        {
          "method": "GET",
          "path": "/api/session",
          "summary": "Get current session status and CSRF token"
        }
      ]
    },
    "ui": {
      "routes": [
        {
          "id": "auth.login",
          "path": "/auth/login",
          "scope": "global",
          "name": "auth-login",
          "componentKey": "auth-login",
          "autoRegister": true,
          "guard": {
            "policy": "public"
          },
          "purpose": "Public login route for authentication flows."
        },
        {
          "id": "auth.signout",
          "path": "/auth/signout",
          "scope": "global",
          "name": "auth-signout",
          "componentKey": "auth-signout",
          "autoRegister": true,
          "guard": {
            "policy": "public"
          },
          "purpose": "Public sign-out route that clears session then returns to login."
        }
      ],
      "elements": [],
      "overrides": []
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@mdi/js": "^7.4.47",
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/http-client-runtime": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0",
        "@jskit-ai/kernel": "0.1.0",
        "vuetify": "^4.0.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": [
      {
        "from": "templates/src/views/auth/LoginView.vue",
        "to": "src/views/auth/LoginView.vue",
        "reason": "Install minimal login container that renders the module-provided DefaultLoginView by default.",
        "category": "auth-web",
        "id": "auth-view-login"
      },
      {
        "from": "templates/src/views/auth/SignOutView.vue",
        "to": "src/views/auth/SignOutView.vue",
        "reason": "Install minimal sign-out container that renders the module-provided SignOutView by default (edit the scaffolded file to customize).",
        "category": "auth-web",
        "id": "auth-view-signout"
      },
      {
        "from": "templates/src/pages/auth/login.vue",
        "to": "src/pages/auth/login.vue",
        "reason": "Provide a global /auth/login wrapper that renders the package login view.",
        "category": "auth-web",
        "id": "auth-page-login"
      },
      {
        "from": "templates/src/pages/auth/signout.vue",
        "to": "src/pages/auth/signout.vue",
        "reason": "Provide a global /auth/signout wrapper that renders the package sign-out view.",
        "category": "auth-web",
        "id": "auth-page-signout"
      }
    ]
  }
});
