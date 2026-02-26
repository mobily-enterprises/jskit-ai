export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/auth-provider-supabase-core",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/access-core",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "auth.provider.supabase",
      "auth.provider"
    ],
    "requires": [
      "auth.access",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/access-core": "0.1.0",
        "@jskit-ai/server-runtime-core": "0.1.0",
        "@supabase/supabase-js": "^2.57.4",
        "jose": "^6.1.0"
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
