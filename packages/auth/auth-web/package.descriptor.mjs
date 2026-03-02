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
    "@jskit-ai/support-core",
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
          "path": "/login",
          "surface": "app",
          "name": "login",
          "purpose": "Public login route for authentication flows."
        },
        {
          "path": "/auth/signout",
          "surface": "app",
          "name": "auth-signout",
          "purpose": "Public sign-out route that clears session then returns to login."
        }
      ],
      "elements": []
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/http-client-runtime": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0",
        "@jskit-ai/support-core": "0.1.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": [
      {
        "from": "templates/src/views/login/LoginView.vue",
        "to": "src/views/login/LoginView.vue",
        "reason": "Install app-owned login view scaffold for auth flows.",
        "category": "auth-web",
        "id": "auth-view-login"
      },
      {
        "from": "templates/src/views/auth/SignOutView.vue",
        "to": "src/views/auth/SignOutView.vue",
        "reason": "Install app-owned sign-out route view scaffold.",
        "category": "auth-web",
        "id": "auth-view-signout"
      },
      {
        "from": "templates/src/runtime/authHttpClient.js",
        "to": "src/runtime/authHttpClient.js",
        "reason": "Provide shared auth HTTP client with CSRF token support.",
        "category": "auth-web",
        "id": "auth-runtime-http-client"
      },
      {
        "from": "templates/src/runtime/authGuardRuntime.js",
        "to": "src/runtime/authGuardRuntime.js",
        "reason": "Provide auth guard runtime integration for protected shell routes.",
        "category": "auth-web",
        "id": "auth-runtime-guard"
      },
      {
        "from": "templates/src/runtime/useSignOut.js",
        "to": "src/runtime/useSignOut.js",
        "reason": "Provide reusable sign-out flow helper for layouts and auth views.",
        "category": "auth-web",
        "id": "auth-runtime-signout"
      }
    ]
  }
});
