import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { settingsRoutesContract as settingsSchema } from "../common/contracts/settingsRoutesContract.js";

function bootAccountProfileRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountProfileRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const authService = app.make("authService");

  router.register(
    "GET",
    "/api/settings",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Get authenticated user's settings"
      },
      response: withStandardErrorResponses({
        200: { schema: settingsSchema.response }
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.read"
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    "/api/settings/profile",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update profile settings"
      },
      body: {
        schema: settingsSchema.body.profile,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: { schema: settingsSchema.response }
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const result = await request.executeAction({
        actionId: "settings.profile.update",
        input: request.input.body
      });

      if (result?.session && typeof authService.writeSessionCookies === "function") {
        authService.writeSessionCookies(reply, result.session);
      }

      reply.code(200).send(result?.settings || result);
    }
  );

  router.register(
    "POST",
    "/api/settings/profile/avatar",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Upload profile avatar",
        description: "Multipart upload (avatar file required, optional uploadDimension field)."
      },
      advanced: {
        fastifySchema: {
          consumes: ["multipart/form-data"]
        }
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.commands["settings.profile.avatar.upload"].operation.response
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const filePart = await request.file();
      if (!filePart) {
        throw new AppError(400, "Validation failed.", {
          details: {
            fieldErrors: {
              avatar: "Avatar file is required."
            }
          }
        });
      }

      const uploadDimension = filePart.fields?.uploadDimension?.value;
      const response = await request.executeAction({
        actionId: "settings.profile.avatar.upload",
        input: {
          stream: filePart.file,
          mimeType: filePart.mimetype,
          fileName: filePart.filename,
          uploadDimension
        }
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "DELETE",
    "/api/settings/profile/avatar",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Delete profile avatar and fallback to gravatar"
      },
      response: withStandardErrorResponses({
        200: settingsSchema.commands["settings.profile.avatar.delete"].operation.response
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.profile.avatar.delete"
      });
      reply.code(200).send(response);
    }
  );
}

export { bootAccountProfileRoutes };
