import globals from "globals";

const SOURCE_FILES = "**/*.{js,mjs,cjs,vue}";

const nodeConfig = Object.freeze([
  {
    files: [SOURCE_FILES],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    }
  }
]);

export { nodeConfig };
