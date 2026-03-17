import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { userProfileResource } from "../../shared/resources/userProfileResource.js";
import { USERS_ACCOUNT_PROFILE_SERVICE_TOKEN } from "./registerAccountProfile.js";

function bootAccountProfileRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountProfileRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const authService = app.make("authService");
  const accountProfileService = app.make(USERS_ACCOUNT_PROFILE_SERVICE_TOKEN);

  router.register(
    "GET",
    "/api/settings",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Get authenticated user's settings"
      },
      responseValidators: withStandardErrorResponses({
        200: userSettingsResource.operations.view.outputValidator
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
      bodyValidator: userProfileResource.operations.patch.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: userSettingsResource.operations.view.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const result = await request.executeAction({
        actionId: "settings.profile.update",
        input: {
          payload: request.input.body
        }
      });

      if (result?.session && typeof authService.writeSessionCookies === "function") {
        authService.writeSessionCookies(reply, result.session);
      }

      reply.code(200).send(result?.settings || result);
    }
  );

  router.register(
    "GET",
    "/api/settings/profile/avatar",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Read authenticated user's uploaded avatar."
      }
    },
    async function (request, reply) {
      const avatar = await accountProfileService.readAvatar(request, request.user, {}, {
        context: {
          actor: request.user
        }
      });

      reply
        .header("Cache-Control", "private, max-age=31536000, immutable")
        .header("Content-Type", avatar.mimeType)
        .send(avatar.buffer);
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
      responseValidators: withStandardErrorResponses(
        {
          200: userProfileResource.operations.avatarUpload.outputValidator
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
      responseValidators: withStandardErrorResponses({
        200: userProfileResource.operations.avatarDelete.outputValidator
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
