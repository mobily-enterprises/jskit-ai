import js from "@eslint/js";

const SOURCE_FILES = "**/*.{js,mjs,cjs,vue}";

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
  }
]);

export { baseConfig };
