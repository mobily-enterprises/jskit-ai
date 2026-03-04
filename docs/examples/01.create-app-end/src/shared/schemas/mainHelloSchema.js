import { Type } from "@fastify/type-provider-typebox";

const mainHelloResponse = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const mainHelloSchema = Object.freeze({
  response: {
    200: mainHelloResponse
  }
});

export { mainHelloSchema };
