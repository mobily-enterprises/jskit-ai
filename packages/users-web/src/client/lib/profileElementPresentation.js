import {
  normalizeObject,
  normalizeOneOf
} from "@jskit-ai/kernel/shared/support/normalize";

// Default copy, by copy prop key; the copy prop overrides it.
const DEFAULT_COPY_KEYS = Object.freeze({
  title: "jskit.users.accountSettings.profile.title",
  previewSizePrefix: "jskit.users.accountSettings.profile.previewSizePrefix",
  previewSizeSuffix: "jskit.users.accountSettings.profile.previewSizeSuffix",
  replaceAvatar: "jskit.users.accountSettings.profile.replaceAvatar",
  removeAvatar: "jskit.users.accountSettings.profile.removeAvatar",
  selectedFilePrefix: "jskit.users.accountSettings.profile.selectedFilePrefix",
  displayName: "jskit.users.accountSettings.profile.displayName",
  email: "jskit.users.accountSettings.profile.email",
  emailHint: "jskit.users.accountSettings.profile.emailHint",
  saveProfile: "jskit.users.accountSettings.profile.save"
});

function resolveProfileCopy(copy, t) {
  return {
    ...Object.fromEntries(Object.entries(DEFAULT_COPY_KEYS).map(([name, key]) => [name, t(key)])),
    ...normalizeObject(copy)
  };
}

function resolveProfileVariant(value) {
  const variant = normalizeObject(value);
  return {
    layout: normalizeOneOf(variant.layout, ["compact", "comfortable"], "comfortable"),
    surface: normalizeOneOf(variant.surface, ["plain", "carded"], "carded"),
    density: normalizeOneOf(variant.density, ["compact", "comfortable"], "comfortable"),
    tone: normalizeOneOf(variant.tone, ["neutral", "emphasized"], "neutral")
  };
}

function resolveProfileFeatures(value) {
  const features = normalizeObject(value);
  return {
    header: features.header !== false,
    removeAvatar: features.removeAvatar !== false
  };
}

function resolveProfileUiClasses(ui) {
  const classes = normalizeObject(normalizeObject(ui).classes);
  return {
    root: String(classes.root || "").trim(),
    card: String(classes.card || "").trim()
  };
}

function resolveProfileUiTestIds(ui) {
  const testIds = normalizeObject(normalizeObject(ui).testIds);
  return {
    root: String(testIds.root || "profile-client-element"),
    card: String(testIds.card || "profile-client-card"),
    submitButton: String(testIds.submitButton || "profile-submit-button"),
    avatarReplaceButton: String(testIds.avatarReplaceButton || "profile-avatar-replace-button"),
    avatarRemoveButton: String(testIds.avatarRemoveButton || "profile-avatar-remove-button")
  };
}

function resolveProfileRootClasses(variant, uiClasses) {
  const classes = [
    "profile-client-element",
    `profile-client-element--layout-${variant.layout}`,
    `profile-client-element--surface-${variant.surface}`,
    `profile-client-element--density-${variant.density}`,
    `profile-client-element--tone-${variant.tone}`
  ];
  if (uiClasses.root) {
    classes.push(uiClasses.root);
  }
  return classes;
}

export {
  resolveProfileCopy,
  resolveProfileFeatures,
  resolveProfileRootClasses,
  resolveProfileUiClasses,
  resolveProfileUiTestIds,
  resolveProfileVariant
};
