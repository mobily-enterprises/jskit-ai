import js from "@eslint/js";

const SOURCE_FILES = "**/*.{js,mjs,cjs,vue}";

const baseConfig = Object.freeze([
  js.configs.recommended,
  {
    files: [SOURCE_FILES],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
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
