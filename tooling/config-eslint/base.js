import js from "@eslint/js";
import { dataAccessConfig } from "./dataAccess.js";
import { jskitPlugin } from "./plugin/index.js";
import { typedFeaturesConfig } from "./typedFeatures.js";

const SOURCE_FILES = "**/*.{js,mjs,cjs,vue}";
// An application's server and shared code: its packages' and the app's own.
const DATA_ACCESS_SOURCES = Object.freeze(["**/src/server/**", "**/src/shared/**", "server/**", "server.js"]);

const baseConfig = Object.freeze([
  {
    ignores: [
      ".jskit/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "test-results/**"
    ]
  },
  js.configs.recommended,
  {
    files: [SOURCE_FILES],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      // ESLint 10 added these rules to its recommended preset. Keep the
      // established JSKIT lint contract stable; adopting either rule requires
      // a deliberate source migration rather than a tooling patch release.
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true
        }
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@jskit-ai/[^/]+$",
              message: "Use explicit JSKIT subpath imports: @jskit-ai/<package>/server or /client."
            }
          ]
        }
      ]
    }
  },
  // A Playwright config passes the managed host's login state on unchanged, in every application.
  {
    files: ["**/playwright.config.{js,mjs,cjs}", "**/playwright.*.config.{js,mjs,cjs}"],
    plugins: { jskit: jskitPlugin },
    rules: {
      "jskit/playwright-login-unchanged": "error"
    }
  },
  // Server code is reported against the typed-features rules; an application
  // makes them errors with typedFeaturesConfig as it converts each package.
  ...typedFeaturesConfig(["**/src/server/**"], "warn"),
  // The resource is the only door to a table: the data-access rules are errors in all server and shared code.
  ...dataAccessConfig(DATA_ACCESS_SOURCES)
]);

export { baseConfig };
