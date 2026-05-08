export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-provider-supabase-core",
  "version": "0.1.65",
  "kind": "runtime",
  "options": {
    "auth-supabase-url": {
      "required": true,
      "values": [],
      "promptLabel": "Supabase URL",
      "promptHint": "https://YOUR-PROJECT.supabase.co"
    },
    "auth-supabase-publishable-key": {
      "required": true,
      "values": [],
      "promptLabel": "Supabase publishable key",
      "promptHint": "sb_publishable_..."
    },
    "app-public-url": {
      "required": true,
      "values": [],
      "defaultValue": "http://localhost:5173",
      "promptLabel": "App public URL",
      "promptHint": "Browser URL used for auth redirects"
    }
  },
  "dependsOn": [
    "@jskit-ai/auth-core",
    "@jskit-ai/value-app-config-shared"
  ],
  "capabilities": {
    "provides": [
      "auth.provider.supabase",
      "auth.provider"
    ],
    "requires": [
      "auth.access"
    ]
  },
  "runtime": {
    "server": {
      "providerEntrypoint": "src/server/providers/AuthSupabaseServiceProvider.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/AuthSupabaseServiceProvider.js",
          "export": "AuthSupabaseServiceProvider"
        },
        {
          "entrypoint": "src/server/providers/AuthProviderServiceProvider.js",
          "export": "AuthProviderServiceProvider"
        }
      ]
    }
  },
  "metadata": {
    "apiSummary": {
      "surfaces": [
        {
          "subpath": "./server/providers/AuthSupabaseServiceProvider",
          "summary": "Exports the Supabase auth provider service provider."
        },
        {
          "subpath": "./server/providers/AuthProviderServiceProvider",
          "summary": "Exports the generic auth provider registration service provider."
        },
        {
          "subpath": "./server/lib/index",
          "summary": "Exports curated server-side Supabase auth service helpers."
        },
        {
          "subpath": "./client",
          "summary": "Exports no runtime API today (reserved client entrypoint)."
        }
      ],
      "containerTokens": {
        "server": [
          "authService"
        ],
        "client": []
      }
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/auth-core": "0.1.65",
        "@jskit-ai/kernel": "0.1.66",
        "dotenv": "^16.4.5",
        "@supabase/supabase-js": "^2.57.4",
        "jose": "^6.1.0"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": [],
    "text": [
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "AUTH_PROVIDER",
        "value": "supabase",
        "reason": "Select Supabase as the auth provider.",
        "category": "runtime-config",
        "id": "auth-provider"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "AUTH_SUPABASE_URL",
        "value": "${option:auth-supabase-url}",
        "reason": "Configure Supabase project URL for auth.",
        "category": "runtime-config",
        "id": "auth-supabase-url"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "AUTH_SUPABASE_PUBLISHABLE_KEY",
        "value": "${option:auth-supabase-publishable-key}",
        "reason": "Configure Supabase publishable key for auth.",
        "category": "runtime-config",
        "id": "auth-supabase-publishable-key"
      },
      {
        "file": ".env",
        "op": "upsert-env",
        "key": "APP_PUBLIC_URL",
        "value": "${option:app-public-url}",
        "reason": "Configure application public URL for auth redirect flows.",
        "category": "runtime-config",
        "id": "auth-app-public-url"
      },
      {
        "op": "append-text",
        "file": "config/server.js",
        "position": "bottom",
        "skipIfContains": "config.auth = {",
        "value": "\nconfig.auth = {\n  oauth: {\n    providers: [],\n    defaultProvider: \"\"\n  }\n};\n",
        "reason": "Append app-owned OAuth provider visibility config for stock auth screens.",
        "category": "runtime-config",
        "id": "auth-oauth-app-config"
      }
    ]
  }
});
