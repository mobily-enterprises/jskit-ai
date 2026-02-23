import { Type } from "@fastify/type-provider-typebox";
import { registerTypeBoxFormats } from "../api/schema/formats.schema.js";

registerTypeBoxFormats();

const decimalStringPattern = "^-?\\d+(?:\\.\\d+)?$";

const body = Type.Object(
  {
    DEG2RAD_operation: Type.Literal("DEG2RAD"),
    DEG2RAD_degrees: Type.Number()
  },
  {
    additionalProperties: false
  }
);

const response = Type.Object(
  {
    DEG2RAD_operation: Type.Literal("DEG2RAD"),
    DEG2RAD_formula: Type.String({ minLength: 1 }),
    DEG2RAD_degrees: Type.String({ pattern: decimalStringPattern }),
    DEG2RAD_radians: Type.String({ pattern: decimalStringPattern }),
    historyId: Type.String({ format: "uuid" })
  },
  {
    additionalProperties: false
  }
);

const schema = {
  body,
  response
};

export { schema };
