export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-fastify-routes",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/http-contracts",
    "@jskit-ai/fastify-auth-policy"
  ],
  "capabilities": {
    "provides": [
      "auth.server-routes"
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
      "entrypoint": "src/shared/server.js",
      "export": "createServerContributions"
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
      "elements": []
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@fastify/type-provider-typebox": "^6.1.0",
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/http-contracts": "0.1.0"
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
