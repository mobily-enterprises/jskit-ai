export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-provider-supabase-core",
  "version": "0.1.0",
  "options": {
    "auth-supabase-url": {
      "required": true,
      "values": [],
      "pattern": "^https://[^\\s]+\\.supabase\\.co/?$",
      "patternHint": "Expected format: https://YOUR-PROJECT.supabase.co",
      "promptLabel": "Supabase URL",
      "promptHint": "https://YOUR-PROJECT.supabase.co"
    },
    "auth-supabase-publishable-key": {
      "required": true,
      "values": [],
      "pattern": "^sb_publishable_[^\\s]+$",
      "patternHint": "Expected format: sb_publishable_...",
      "promptLabel": "Supabase publishable key",
      "promptHint": "sb_publishable_..."
    },
    "app-public-url": {
      "required": true,
      "values": [],
      "defaultValue": "http://localhost:5173",
      "pattern": "^https?://[^\\s]+$",
      "patternHint": "Expected format: http://localhost:5173",
      "promptLabel": "App public URL",
      "promptHint": "Browser URL used for auth redirects"
    }
  },
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/action-runtime-core",
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
      "providerEntrypoint": "src/server/index.js",
      "providers": [
        {
          "entrypoint": "src/server/providers/AuthSupabaseServiceProvider.js",
          "export": "AuthSupabaseServiceProvider"
        }
      ]
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/action-runtime-core": "0.1.0",
        "@jskit-ai/framework-core": "0.1.0",
        "dotenv": "^16.6.1",
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
      }
    ]
  }
});
