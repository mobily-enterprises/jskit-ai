import { buildRoutes as buildSettingsAdapterRoutes } from "@jskit-ai/settings-fastify-adapter";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_UPLOAD_DIMENSION,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_UPLOAD_DIMENSION_OPTIONS
} from "../../../shared/avatar.js";

function buildRoutes(controllers) {
  return buildSettingsAdapterRoutes(controllers, {
    avatarUploadPolicy: {
      allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
      maxUploadBytes: AVATAR_MAX_UPLOAD_BYTES,
      uploadDimensionOptions: AVATAR_UPLOAD_DIMENSION_OPTIONS,
      defaultUploadDimension: AVATAR_DEFAULT_UPLOAD_DIMENSION
    }
  });
}

export { buildRoutes };
