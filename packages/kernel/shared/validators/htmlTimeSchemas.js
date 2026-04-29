const HTML_TIME_STRING_SCHEMA = Object.freeze({
  type: "string",
  pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$",
  minLength: 5
});

const NULLABLE_HTML_TIME_STRING_SCHEMA = Object.freeze({
  ...HTML_TIME_STRING_SCHEMA,
  nullable: true
});

export {
  HTML_TIME_STRING_SCHEMA,
  NULLABLE_HTML_TIME_STRING_SCHEMA
};
