import { Type } from "@fastify/type-provider-typebox";

const serviceStatusSchema = Type.Union([Type.Literal("ok"), Type.Literal("degraded")]);
const dependencyStatusSchema = Type.Union([Type.Literal("up"), Type.Literal("down")]);

const baseHealthSchema = Type.Object(
  {
    ok: Type.Boolean(),
    status: serviceStatusSchema,
    timestamp: Type.String({ minLength: 1 }),
    uptimeSeconds: Type.Number({ minimum: 0 })
  },
  {
    additionalProperties: false
  }
);

const readinessSchema = Type.Object(
  {
    ...baseHealthSchema.properties,
    dependencies: Type.Object(
      {
        database: dependencyStatusSchema
      },
      {
        additionalProperties: false
      }
    )
  },
  {
    additionalProperties: false
  }
);

const schema = {
  response: {
    health: baseHealthSchema,
    readiness: readinessSchema
  }
};

export { schema };
