import { buildRoutes as buildSettingsAdapterRoutes } from "@jskit-ai/settings-fastify-routes/server";
import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_UPLOAD_DIMENSION,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_UPLOAD_DIMENSION_OPTIONS
} from "../../../shared/avatar.js";

const SETTINGS_EXTENSION_ID_PATTERN = "^[a-z][a-z0-9._:-]{1,127}$";

const settingsExtensionParamsSchema = Type.Object(
  {
    extensionId: Type.String({
      minLength: 2,
      maxLength: 128,
      pattern: SETTINGS_EXTENSION_ID_PATTERN
    })
  },
  {
    additionalProperties: false
  }
);

const settingsExtensionBodySchema = Type.Object(
  {},
  {
    additionalProperties: true,
    minProperties: 1
  }
);

const settingsExtensionFieldSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: true
  }
);

const settingsExtensionResponseSchema = Type.Object(
  {
    extensionId: Type.String({ minLength: 2, maxLength: 128 }),
    fields: Type.Array(settingsExtensionFieldSchema),
    value: Type.Object({}, { additionalProperties: true })
  },
  {
    additionalProperties: false
  }
);

function createDefaultMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "Endpoint is not available in this server wiring."
    });
  };
}

function buildRoutes(controllers, options = {}) {
  const missingHandler = typeof options?.missingHandler === "function" ? options.missingHandler : createDefaultMissingHandler();
  const baseRoutes = buildSettingsAdapterRoutes(controllers, {
    avatarUploadPolicy: {
      allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
      maxUploadBytes: AVATAR_MAX_UPLOAD_BYTES,
      uploadDimensionOptions: AVATAR_UPLOAD_DIMENSION_OPTIONS,
      defaultUploadDimension: AVATAR_DEFAULT_UPLOAD_DIMENSION
    }
  });

  return [
    ...baseRoutes,
    {
      path: "/api/settings/extensions/:extensionId",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Read a custom settings extension value",
        params: settingsExtensionParamsSchema,
        response: withStandardErrorResponses({
          200: settingsExtensionResponseSchema
        })
      },
      handler: controllers.settings?.getExtension || missingHandler
    },
    {
      path: "/api/settings/extensions/:extensionId",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Update a custom settings extension value",
        params: settingsExtensionParamsSchema,
        body: settingsExtensionBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsExtensionResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings?.updateExtension || missingHandler
    }
  ];
}

export { buildRoutes };
