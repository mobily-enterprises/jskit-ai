import { Type } from "typebox";
import { normalizeLowerText } from "../../shared/actions/textNormalization.js";
import { normalizeObjectInput } from "../../shared/contracts/inputNormalization.js";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { resolveBootstrapPayload } from "./bootstrapContributors.js";

const bootstrapQueryValidator = Object.freeze({
  schema: Type.Object(
    {
      workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    if (!Object.hasOwn(source, "workspaceSlug")) {
      return {};
    }

    return {
      workspaceSlug: normalizeLowerText(source.workspaceSlug)
    };
  }
});

const bootstrapOutputValidator = Object.freeze({
  schema: Type.Object({}, { additionalProperties: true }),
  normalize: normalizeObjectInput
});

function bootBootstrapRoutes(app) {
  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "GET",
    "/api/bootstrap",
    {
      auth: "public",
      meta: {
        tags: ["bootstrap"],
        summary: "Resolve app bootstrap payload from registered contributors"
      },
      query: bootstrapQueryValidator,
      response: {
        200: bootstrapOutputValidator
      }
    },
    async function (request, reply) {
      const payload = await resolveBootstrapPayload(app, {
        request,
        reply,
        query: request.input?.query || {},
        workspaceSlug: request.input?.query?.workspaceSlug
      });

      reply.code(200).send(payload);
    }
  );
}

export { bootBootstrapRoutes, bootstrapQueryValidator, bootstrapOutputValidator };
