import { SETTINGS_DEFAULTS } from "../../../../../shared/settings/model.js";

export function createDefaultAvatar() {
  return {
    uploadedUrl: null,
    gravatarUrl: "",
    effectiveUrl: "",
    hasUploadedAvatar: false,
    size: SETTINGS_DEFAULTS.avatarSize,
    version: null
  };
}
