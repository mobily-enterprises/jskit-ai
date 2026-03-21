import { Type } from "typebox";
import { normalizeObjectInput } from "../../shared/validators/inputNormalization.js";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { resolveBootstrapPayload } from "../registries/bootstrapPayloadContributorRegistry.js";

const bootstrapQueryValidator = Object.freeze({
  schema: Type.Object({}, { additionalProperties: true }),
  normalize: normalizeObjectInput
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
      queryValidator: bootstrapQueryValidator,
      responseValidators: {
        200: bootstrapOutputValidator
      }
    },
    async function (request, reply) {
      const payload = await resolveBootstrapPayload(app, {
        request,
        reply,
        query: request.input?.query || {}
      });

      reply.code(200).send(payload);
    }
  );
}

export { bootBootstrapRoutes, bootstrapQueryValidator, bootstrapOutputValidator };
