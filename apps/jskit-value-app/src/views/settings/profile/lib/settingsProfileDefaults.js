import { SETTINGS_DEFAULTS } from "../../../../modules/settings/settingsCatalog.js";

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
