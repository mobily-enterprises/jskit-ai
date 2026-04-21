export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-web",
  "version": "0.1.50",
  "kind": "runtime",
  "description": "Auth web module: Fastify auth routes plus web login/sign-out scaffolds.",
  "dependsOn": [
    "@jskit-ai/auth-core",
    "@jskit-ai/http-runtime",
    "@jskit-ai/shell-web",
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
      "validators.http",
      "auth.policy",
      "runtime.web-placement"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/providers/AuthWebServiceProvider.js",
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
    "apiSummary": {
      "surfaces": [
        {
          "subpath": "./client",
          "summary": "Exports auth web client provider, default auth views, and route/provider registration surface."
        },
        {
          "subpath": "./server",
          "summary": "Exports auth web server providers, controller/service classes, route builders, and HTTP schema modules."
        }
      ],
      "containerTokens": {
        "server": [
          "auth.web.service"
        ],
        "client": [
          "runtime.auth-guard.client",
          "auth.login.component",
          "auth.login.useLoginView",
          "auth.web.profile.widget",
          "auth.web.profile.menu.link-item"
        ]
      }
    },
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
          "scope": "surface",
          "surface": "auth",
          "name": "auth-login",
          "componentKey": "auth-login",
          "autoRegister": false,
          "guard": {
            "policy": "public"
          },
          "purpose": "Public login route for authentication flows."
        },
        {
          "id": "auth.signout",
          "path": "/auth/signout",
          "scope": "surface",
          "surface": "auth",
          "name": "auth-signout",
          "componentKey": "auth-signout",
          "autoRegister": false,
          "guard": {
            "policy": "public"
          },
          "purpose": "Public sign-out route that clears session then returns to login."
        },
        {
          "id": "auth.default-login",
          "path": "/auth/default-login",
          "scope": "surface",
          "surface": "auth",
          "name": "auth-default-login",
          "componentKey": "auth-default-login",
          "autoRegister": true,
          "guard": {
            "policy": "public"
          },
          "purpose": "Default module-supplied login screen."
        }
      ],
      "elements": [],
      "overrides": [],
      "placements": {
        "outlets": [
          {
            "target": "auth-profile-menu:primary-menu",
            "defaultLinkComponentToken": "auth.web.profile.menu.link-item",
            "surfaces": ["*"],
            "source": "src/client/views/AuthProfileWidget.vue"
          }
        ],
        "contributions": [
          {
            "id": "auth.profile.widget",
            "target": "shell-layout:top-right",
            "surfaces": ["*"],
            "order": 1000,
            "componentToken": "auth.web.profile.widget",
            "source": "mutations.text#auth-web-placement-block"
          },
          {
            "id": "auth.profile.menu.sign-in",
            "target": "auth-profile-menu:primary-menu",
            "surfaces": ["*"],
            "order": 200,
            "componentToken": "auth.web.profile.menu.link-item",
            "when": "auth.authenticated !== true",
            "source": "mutations.text#auth-web-placement-block"
          },
          {
            "id": "auth.profile.menu.sign-out",
            "target": "auth-profile-menu:primary-menu",
            "surfaces": ["*"],
            "order": 1000,
            "componentToken": "auth.web.profile.menu.link-item",
            "when": "auth.authenticated === true",
            "source": "mutations.text#auth-web-placement-block"
          }
        ]
      }
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@tanstack/vue-query": "5.92.12",
        "@mdi/js": "^7.4.47",
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/auth-core": "0.1.48",
        "@jskit-ai/http-runtime": "0.1.48",
        "@jskit-ai/kernel": "0.1.49",
        "@jskit-ai/shell-web": "0.1.48",
        "vuetify": "^4.0.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {
        "server:auth": "SERVER_SURFACE=auth node ./bin/server.js",
        "dev:auth": "VITE_SURFACE=auth vite",
        "build:auth": "VITE_SURFACE=auth vite build"
      }
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
        "reason": "Provide an auth-surface /auth/login wrapper that renders the package login view.",
        "category": "auth-web",
        "id": "auth-page-login"
      },
      {
        "from": "templates/src/pages/auth/signout.vue",
        "to": "src/pages/auth/signout.vue",
        "reason": "Provide an auth-surface /auth/signout wrapper that renders the package sign-out view.",
        "category": "auth-web",
        "id": "auth-page-signout"
      }
    ],
    "text": [
      {
        "op": "append-text",
        "file": "config/public.js",
        "position": "bottom",
        "skipIfContains": "config.surfaceDefinitions.auth = {",
        "value": "\nconfig.surfaceDefinitions.auth = {\n  id: \"auth\",\n  label: \"Auth\",\n  pagesRoot: \"auth\",\n  enabled: true,\n  requiresAuth: false,\n  requiresWorkspace: false,\n  origin: \"\"\n};\n",
        "reason": "Register auth surface definition in public surface config.",
        "category": "auth-web",
        "id": "auth-web-surface-config-auth"
      },
      {
        "op": "append-text",
        "file": "src/placement.js",
        "position": "bottom",
        "skipIfContains": "id: \"auth.profile.widget\"",
        "value": "\naddPlacement({\n  id: \"auth.profile.widget\",\n  target: \"shell-layout:top-right\",\n  surfaces: [\"*\"],\n  order: 1000,\n  componentToken: \"auth.web.profile.widget\"\n});\n\naddPlacement({\n  id: \"auth.profile.menu.sign-in\",\n  target: \"auth-profile-menu:primary-menu\",\n  surfaces: [\"*\"],\n  order: 200,\n  componentToken: \"auth.web.profile.menu.link-item\",\n  props: {\n    label: \"Sign in\",\n    to: \"/auth/login\"\n  },\n  when: ({ auth }) => auth?.authenticated !== true\n});\n\naddPlacement({\n  id: \"auth.profile.menu.sign-out\",\n  target: \"auth-profile-menu:primary-menu\",\n  surfaces: [\"*\"],\n  order: 1000,\n  componentToken: \"auth.web.profile.menu.link-item\",\n  props: {\n    label: \"Sign out\",\n    to: \"/auth/signout\"\n  },\n  when: ({ auth }) => auth?.authenticated === true\n});\n",
        "reason": "Append auth profile placement entries into app-owned placement registry.",
        "category": "auth-web",
        "id": "auth-web-placement-block"
      }
    ]
  }
});
