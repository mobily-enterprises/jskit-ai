import { Type } from "@fastify/type-provider-typebox";

const schema = {
  response: {
    metrics: Type.String()
  }
};

export { schema };
