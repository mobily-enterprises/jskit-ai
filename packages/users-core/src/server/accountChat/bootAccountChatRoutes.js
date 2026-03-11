import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { chatPatchBodySchema } from "../../shared/resources/userSettingsResource.js";
import { settingsResponseValidator } from "../common/validators/settingsResponseValidator.js";

function bootAccountChatRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountChatRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "PATCH",
    "/api/settings/chat",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update chat settings"
      },
      body: {
        schema: chatPatchBodySchema,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: { schema: settingsResponseValidator.schema }
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.chat.update",
        input: request.input.body
      });
      reply.code(200).send(response);
    }
  );
}

export { bootAccountChatRoutes };
