import { Type } from "@fastify/type-provider-typebox";

const routeQueries = Object.freeze({
  pagination: Object.freeze({
    schema: Type.Object(
      {
        cursor: Type.Optional(Type.String({ minLength: 1 })),
        limit: Type.Optional(
          Type.String({
            pattern: "^[0-9]+$"
          })
        )
      },
      { additionalProperties: false }
    )
  }),
  search: Object.freeze({
    schema: Type.Object(
      {
        search: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  }),
  oauthReturnTo: Object.freeze({
    schema: Type.Object(
      {
        returnTo: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  }),
  workspaceBootstrap: Object.freeze({
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  })
});

export {
  routeQueries
};
