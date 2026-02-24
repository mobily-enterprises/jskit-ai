import { Type } from "@fastify/type-provider-typebox";
import { enumSchema } from "@jskit-ai/http-contracts/errorResponses";

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

const sendEmail = Type.Object(
  {
    to: Type.String({ minLength: 3, maxLength: 320 }),
    subject: Type.String({ minLength: 1, maxLength: 998 }),
    text: Type.Optional(Type.String({ minLength: 1 })),
    html: Type.Optional(Type.String({ minLength: 1 })),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  {
    additionalProperties: false
  }
);

const sendEmailResponse = Type.Object(
  {
    sent: Type.Boolean(),
    reason,
    provider: Type.String({ minLength: 1 }),
    messageId: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const schema = {
  body: {
    sendSms,
    sendEmail
  },
  response: {
    sendSms: sendSmsResponse,
    sendEmail: sendEmailResponse
  }
};

export { schema };
