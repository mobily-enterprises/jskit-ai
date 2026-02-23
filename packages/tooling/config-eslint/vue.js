import vue from "eslint-plugin-vue";

const VUE_RELATED_FILES = "**/*.{js,mjs,cjs,vue}";

const vueConfig = Object.freeze([
  ...vue.configs["flat/recommended"],
  {
    files: [VUE_RELATED_FILES],
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/attributes-order": "off",
      "vue/one-component-per-file": "off"
    }
  }
]);

export { vueConfig };
