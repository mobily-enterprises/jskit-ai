import { Type } from "@fastify/type-provider-typebox";
import { enumSchema } from "../api/schema.js";

const phoneNumber = Type.String({
  pattern: "^\\+[1-9][0-9]{7,14}$"
});

const provider = enumSchema(["none", "plivo"]);
const reason = enumSchema(["invalid_recipient", "invalid_message", "not_configured", "not_implemented"]);

const sendSms = Type.Object(
  {
    to: phoneNumber,
    text: Type.String({ minLength: 1, maxLength: 1600 }),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false
  }
);

const sendSmsResponse = Type.Object(
  {
    sent: Type.Boolean(),
    reason,
    provider,
    messageId: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const schema = {
  body: {
    sendSms
  },
  response: {
    sendSms: sendSmsResponse
  }
};

export { schema };
