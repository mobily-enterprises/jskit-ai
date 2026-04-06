import { Type } from "typebox";

const HTML_TIME_STRING_SCHEMA = Type.String({
  pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$",
  minLength: 5
});

const NULLABLE_HTML_TIME_STRING_SCHEMA = Type.Union([HTML_TIME_STRING_SCHEMA, Type.Null()]);

export {
  HTML_TIME_STRING_SCHEMA,
  NULLABLE_HTML_TIME_STRING_SCHEMA
};
