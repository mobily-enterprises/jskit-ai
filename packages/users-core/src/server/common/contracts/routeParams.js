import { Type } from "@fastify/type-provider-typebox";

const routeParams = Object.freeze({
  workspaceSlug: Object.freeze({
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  }),
  memberUserId: Object.freeze({
    schema: Type.Object(
      {
        memberUserId: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  }),
  inviteId: Object.freeze({
    schema: Type.Object(
      {
        inviteId: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  }),
  provider: Object.freeze({
    schema: Type.Object(
      {
        provider: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  })
});

export {
  routeParams
};
