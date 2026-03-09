import { Type } from "@fastify/type-provider-typebox";

const settings = Type.Object(
  {
    assistantSystemPromptWorkspace: Type.String()
  },
  { additionalProperties: false }
);

const schema = Object.freeze({
  body: {
    update: Type.Object(
      {
        assistantSystemPromptWorkspace: Type.String()
      },
      { additionalProperties: false }
    )
  },
  response: {
    settings: Type.Object(
      {
        settings
      },
      { additionalProperties: false }
    )
  }
});

export { schema };
