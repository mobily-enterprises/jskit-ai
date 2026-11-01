const SOURCE_FILES = "**/*.{js,mjs}";
// Lines that may run past the width: allow comments, ESLint directives and JSDoc type tags, whose text cannot wrap.
const LONG_TEXT_PATTERN = "readable-check: allow|eslint-disable|@typedef|@type \\{|@param \\{|@property \\{|@returns \\{";
const NOT_FORMATTED = Object.freeze([
  "**/{test,tests}/**",
  "**/*.test.*"
]);

const FORMATTER_RULES = Object.freeze({
  // Code, comments and JSDoc prose wrap at 140 characters; long prose stays inline in strings and templates.
  "max-len": ["error", {
    code: 140,
    ignoreUrls: true,
    ignoreStrings: true,
    ignoreTemplateLiterals: true,
    ignoreRegExpLiterals: true,
    ignorePattern: LONG_TEXT_PATTERN
  }],
  semi: ["error", "always"],
  quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
  "comma-dangle": ["error", "never"],
  "space-before-function-paren": ["error", { anonymous: "ignore", named: "never", asyncArrow: "ignore" }],
  // One layout: a one-line `if (x) return y;`, or braces; one property per line once an object spans lines.
  curly: ["error", "multi-line", "consistent"],
  "nonblock-statement-body-position": ["error", "beside"],
  "object-curly-newline": ["error", { multiline: true, consistent: true }],
  "object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],
  "function-paren-newline": ["error", "multiline-arguments"],
  "max-statements-per-line": ["error", { max: 2 }],
  "no-multi-spaces": "error"
});

/**
 * The one formatter config of a JSKIT application, as errors, for the source files the globs select: width 140,
 * semicolons, double quotes, no trailing commas, one property per line in an object that spans lines, and a one-line
 * `if` only without braces. Tests are not formatted.
 * @param {string[]} files
 * @param {{ ignores?: string[] }} [options] Files the formatter never touches, such as published scripts that must not
 * change.
 */
function formatterConfig(files, { ignores = [] } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("formatterConfig requires a list of file globs.");
  }
  return Object.freeze([
    Object.freeze({
      files: files.map((pattern) => [pattern, SOURCE_FILES]),
      ignores: [...NOT_FORMATTED, ...ignores],
      rules: FORMATTER_RULES
    })
  ]);
}

export { formatterConfig };
