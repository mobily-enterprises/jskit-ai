import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { DEFAULT_IMAGE_UPLOAD_MAX_BYTES } from "@jskit-ai/uploads-runtime/shared";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { userProfileResource } from "../../shared/resources/userProfileResource.js";
import { resolveAccountSettingsResourceId } from "../common/support/accountSettingsJsonApiTransport.js";

const USER_SETTINGS_RESOURCE_TRANSPORT = Object.freeze({
  responseType: "user-settings",
  output: userSettingsResource.operations.view.output,
  outputKind: "record",
  getRecordId: resolveAccountSettingsResourceId
});

function registerAccountProfileRoutes(router, { accountProfileService, authService, uploads } = {}) {
  if (!router || typeof router.register !== "function") {
    throw new TypeError("registerAccountProfileRoutes requires router.register().");
  }
  if (!accountProfileService || typeof accountProfileService.readAvatar !== "function") {
    throw new TypeError("registerAccountProfileRoutes requires accountProfileService.");
  }
  if (!uploads || typeof uploads.readSingleMultipartFile !== "function") {
    throw new TypeError("registerAccountProfileRoutes requires runtime.uploads.");
  }

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
      const filePart = await uploads.readSingleMultipartFile(request, {
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
          ...(uploadDimension !== undefined ? { uploadDimension } : {})
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

export { registerAccountProfileRoutes };
