import js from "@eslint/js";

const SOURCE_FILES = "**/*.{js,mjs,cjs,vue}";

const baseConfig = Object.freeze([
  js.configs.recommended,
  {
    files: [SOURCE_FILES],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    }
  }
]);

export { baseConfig };
