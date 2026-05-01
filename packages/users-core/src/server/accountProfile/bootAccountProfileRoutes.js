import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { DEFAULT_IMAGE_UPLOAD_MAX_BYTES } from "@jskit-ai/uploads-runtime/shared";
import { readSingleMultipartFile } from "@jskit-ai/uploads-runtime/server/multipart/readSingleMultipartFile";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { userProfileResource } from "../../shared/resources/userProfileResource.js";
import { resolveAccountSettingsResourceId } from "../common/support/accountSettingsJsonApiTransport.js";

const USER_SETTINGS_RESOURCE_TRANSPORT = Object.freeze({
  responseType: "user-settings",
  output: userSettingsResource.operations.view.output,
  outputKind: "record",
  getRecordId: resolveAccountSettingsResourceId
});

function bootAccountProfileRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountProfileRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");

  router.register(
    "GET",
    "/api/settings",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Get authenticated user's settings"
      },
      ...createJsonApiResourceRouteContract({
        ...USER_SETTINGS_RESOURCE_TRANSPORT
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
      ...createJsonApiResourceRouteContract({
        requestType: "user-profiles",
        body: userProfileResource.operations.patch.body,
        includeValidation400: true,
        ...USER_SETTINGS_RESOURCE_TRANSPORT
      })
    },
    async function (request, reply) {
      const result = await request.executeAction({
        actionId: "settings.profile.update",
        input: request.input.body
      });

      const authService = app.make("authService");
      if (result?.session && typeof authService.writeSessionCookies === "function") {
        authService.writeSessionCookies(reply, result.session);
      }

      reply.code(200).send(result?.response || result);
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
      const accountProfileService = app.make("users.accountProfile.service");
      const avatar = await accountProfileService.readAvatar(request, request.user, {
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
      responses: withStandardErrorResponses(
        {
          200: userProfileResource.operations.avatarUpload.output
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const filePart = await readSingleMultipartFile(request, {
        fieldName: "avatar",
        required: true,
        fieldErrorKey: "avatar",
        label: "Avatar",
        maxBytes: DEFAULT_IMAGE_UPLOAD_MAX_BYTES
      });

      const uploadDimension = filePart.fields?.uploadDimension?.value;
      const response = await request.executeAction({
        actionId: "settings.profile.avatar.upload",
        input: {
          stream: filePart.stream,
          mimeType: filePart.mimeType,
          fileName: filePart.fileName,
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
      ...createJsonApiResourceRouteContract({
        ...USER_SETTINGS_RESOURCE_TRANSPORT
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
