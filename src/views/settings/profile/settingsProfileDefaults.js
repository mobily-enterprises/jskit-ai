import { AVATAR_DEFAULT_SIZE } from "../../../../shared/avatar/index.js";

export function createDefaultAvatar() {
  return {
    uploadedUrl: null,
    gravatarUrl: "",
    effectiveUrl: "",
    hasUploadedAvatar: false,
    size: AVATAR_DEFAULT_SIZE,
    version: null
  };
}
