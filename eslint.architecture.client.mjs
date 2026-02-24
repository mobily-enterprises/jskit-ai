export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/.artifacts/**"]
  },
  {
    files: ["packages/**/src/**/*.js"],
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
              group: [
                "*.css",
                "*.scss",
                "*.sass",
                "*.less",
                "*.styl",
                "*.stylus",
                "**/*.css",
                "**/*.scss",
                "**/*.sass",
                "**/*.less",
                "**/*.styl",
                "**/*.stylus"
              ],
              message: "Headless packages must not import style assets."
            },
            {
              group: [
                "vuetify",
                "vuetify/*",
                "@mdi/*",
                "@fortawesome/*",
                "@heroicons/*",
                "@chakra-ui/*",
                "@mui/*",
                "antd",
                "antd/*"
              ],
              message: "Headless packages must not depend on visual UI frameworks or icon packs."
            }
          ]
        }
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message: "Use explicit named exports in package src/index.js files."
        },
        {
          selector: "CallExpression[callee.name='createApp']",
          message: "Headless packages must not call createApp."
        },
        {
          selector: "CallExpression[callee.name='defineComponent']",
          message: "Headless packages must not call defineComponent."
        }
      ]
    }
  },
  {
    files: ["apps/**/src/**/*.js", "apps/**/server/**/*.js", "apps/**/shared/**/*.js"],
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
              group: ["@jskit-ai/*/src/*", "@jskit-ai/*/test/*", "@jskit-ai/*/tests/*", "@jskit-ai/*/lib/*"],
              message: "Import through package export seams only (package root or documented public subpaths)."
            },
            {
              group: ["**/packages/**"],
              message: "Import through package export seams only (no relative path leakage into /packages)."
            }
          ]
        }
      ]
    }
  }
];
