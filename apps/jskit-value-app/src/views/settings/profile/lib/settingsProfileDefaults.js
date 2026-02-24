import { SETTINGS_DEFAULTS } from "@jskit-ai/workspace-console-core/settingsModel";

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
