import globals from "globals";

const SOURCE_FILES = "**/*.{js,mjs,cjs,vue}";

const webConfig = Object.freeze([
  {
    files: [SOURCE_FILES],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  }
]);

export { webConfig };
