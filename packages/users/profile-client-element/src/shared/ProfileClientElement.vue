<template>
  <section :class="rootClasses" :data-testid="uiTestIds.root">
    <v-card
      class="profile-client-card"
      :class="uiClasses.card"
      :rounded="resolvedVariant.surface === 'plain' ? '0' : 'lg'"
      :elevation="resolvedVariant.surface === 'plain' ? 0 : 0"
      :border="resolvedVariant.surface !== 'plain'"
      :variant="resolvedVariant.surface === 'plain' ? 'text' : undefined"
      :data-testid="uiTestIds.card"
    >
      <v-card-item v-if="resolvedFeatures.header">
        <v-card-title class="text-subtitle-1">{{ copyText.title }}</v-card-title>
      </v-card-item>
      <v-divider v-if="resolvedFeatures.header" />
      <v-card-text>
        <slot name="form-before" :state="state" :actions="actions" />

        <v-form @submit.prevent="onSubmitProfile" novalidate>
          <v-row class="mb-2">
            <v-col cols="12" md="4" class="d-flex flex-column align-center justify-center">
              <v-avatar :size="state.preferencesForm.avatarSize" color="surface-variant" rounded="circle" class="mb-3">
                <v-img v-if="state.profileAvatar.effectiveUrl" :src="state.profileAvatar.effectiveUrl" cover />
                <span v-else class="text-h6">{{ state.profileInitials }}</span>
              </v-avatar>
              <div class="text-caption text-medium-emphasis">
                {{ copyText.previewSizePrefix }} {{ state.preferencesForm.avatarSize }} {{ copyText.previewSizeSuffix }}
              </div>
            </v-col>
            <v-col cols="12" md="8">
              <div class="d-flex flex-wrap ga-2 mb-2">
                <v-btn variant="tonal" color="secondary" :data-testid="uiTestIds.avatarReplaceButton" @click="onAvatarReplace">
                  {{ copyText.replaceAvatar }}
                </v-btn>
                <v-btn
                  v-if="resolvedFeatures.removeAvatar && state.profileAvatar.hasUploadedAvatar"
                  variant="text"
                  color="error"
                  :data-testid="uiTestIds.avatarRemoveButton"
                  :loading="state.avatarDeleteMutation.isPending.value"
                  @click="onAvatarRemove"
                >
                  {{ copyText.removeAvatar }}
                </v-btn>
                <slot name="avatar-actions-extra" :state="state" :actions="actions" />
              </div>
              <div v-if="state.selectedAvatarFileName" class="text-caption text-medium-emphasis mb-2">
                {{ copyText.selectedFilePrefix }} {{ state.selectedAvatarFileName }}
              </div>

              <v-alert v-if="state.avatarMessage" :type="state.avatarMessageType" variant="tonal" class="mb-0">
                {{ state.avatarMessage }}
              </v-alert>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="state.profileForm.displayName"
                :label="copyText.displayName"
                variant="outlined"
                :density="resolvedVariant.density"
                autocomplete="nickname"
                :error-messages="state.profileFieldErrors.displayName ? [state.profileFieldErrors.displayName] : []"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="state.profileForm.email"
                :label="copyText.email"
                variant="outlined"
                :density="resolvedVariant.density"
                readonly
                :hint="copyText.emailHint"
                persistent-hint
              />
            </v-col>
          </v-row>

          <v-alert v-if="state.profileMessage" :type="state.profileMessageType" variant="tonal" class="mb-3">
            {{ state.profileMessage }}
          </v-alert>

          <v-btn type="submit" color="primary" :loading="state.profileMutation.isPending.value" :data-testid="uiTestIds.submitButton">
            {{ copyText.saveProfile }}
          </v-btn>

          <slot name="form-after" :state="state" :actions="actions" />
        </v-form>

        <slot name="footer-extra" :state="state" :actions="actions" />
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";

const DEFAULT_COPY = Object.freeze({
  title: "Profile",
  previewSizePrefix: "Preview size:",
  previewSizeSuffix: "px",
  replaceAvatar: "Replace avatar",
  removeAvatar: "Remove avatar",
  selectedFilePrefix: "Selected file:",
  displayName: "Display name",
  email: "Email",
  emailHint: "Managed by Supabase Auth",
  saveProfile: "Save profile"
});

const props = defineProps({
  state: {
    type: Object,
    required: true
  },
  actions: {
    type: Object,
    required: true
  },
  copy: {
    type: Object,
    default: () => ({})
  },
  variant: {
    type: Object,
    default: () => ({})
  },
  features: {
    type: Object,
    default: () => ({})
  },
  ui: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(["action:started", "action:succeeded", "action:failed", "interaction", "profile:submit", "avatar:replace", "avatar:remove"]);

function toRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeVariantValue(value, supported, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!supported.includes(normalized)) {
    return fallback;
  }
  return normalized;
}

const state = props.state;
const actions = props.actions;

const copyText = computed(() => ({
  ...DEFAULT_COPY,
  ...toRecord(props.copy)
}));

const resolvedVariant = computed(() => {
  const variant = toRecord(props.variant);
  return {
    layout: normalizeVariantValue(variant.layout, ["compact", "comfortable"], "comfortable"),
    surface: normalizeVariantValue(variant.surface, ["plain", "carded"], "carded"),
    density: normalizeVariantValue(variant.density, ["compact", "comfortable"], "comfortable"),
    tone: normalizeVariantValue(variant.tone, ["neutral", "emphasized"], "neutral")
  };
});

const resolvedFeatures = computed(() => {
  const features = toRecord(props.features);
  return {
    header: features.header !== false,
    removeAvatar: features.removeAvatar !== false
  };
});

const uiClasses = computed(() => {
  const classes = toRecord(toRecord(props.ui).classes);
  return {
    root: String(classes.root || "").trim(),
    card: String(classes.card || "").trim()
  };
});

const uiTestIds = computed(() => {
  const testIds = toRecord(toRecord(props.ui).testIds);
  return {
    root: String(testIds.root || "profile-client-element"),
    card: String(testIds.card || "profile-client-card"),
    submitButton: String(testIds.submitButton || "profile-submit-button"),
    avatarReplaceButton: String(testIds.avatarReplaceButton || "profile-avatar-replace-button"),
    avatarRemoveButton: String(testIds.avatarRemoveButton || "profile-avatar-remove-button")
  };
});

const rootClasses = computed(() => {
  const classes = [
    "profile-client-element",
    `profile-client-element--layout-${resolvedVariant.value.layout}`,
    `profile-client-element--surface-${resolvedVariant.value.surface}`,
    `profile-client-element--density-${resolvedVariant.value.density}`,
    `profile-client-element--tone-${resolvedVariant.value.tone}`
  ];
  if (uiClasses.value.root) {
    classes.push(uiClasses.value.root);
  }
  return classes;
});

function emitInteraction(type, payload = {}) {
  emit("interaction", {
    type,
    ...payload
  });
}

async function invokeAction(actionName, payload, callback) {
  emit("action:started", {
    action: actionName,
    payload
  });
  try {
    if (typeof callback === "function") {
      await callback();
    }
    emit("action:succeeded", {
      action: actionName,
      payload
    });
  } catch (errorValue) {
    emit("action:failed", {
      action: actionName,
      payload,
      message: String(errorValue?.message || "Action failed")
    });
    throw errorValue;
  }
}

async function onSubmitProfile() {
  const payload = {
    displayName: String(state.profileForm?.displayName || "").trim()
  };
  emit("profile:submit", payload);
  emitInteraction("profile:submit", payload);
  await invokeAction("submitProfile", payload, actions.submitProfile);
}

async function onAvatarReplace() {
  emit("avatar:replace", {});
  emitInteraction("avatar:replace");
  await invokeAction("openAvatarEditor", {}, actions.openAvatarEditor);
}

async function onAvatarRemove() {
  emit("avatar:remove", {});
  emitInteraction("avatar:remove");
  await invokeAction("submitAvatarDelete", {}, actions.submitAvatarDelete);
}
</script>

<style scoped>
.profile-client-element--layout-compact :deep(.v-card-item),
.profile-client-element--layout-compact :deep(.v-card-text) {
  padding-block: 0.72rem;
}

.profile-client-element--surface-plain .profile-client-card {
  box-shadow: none;
  border-width: 0;
}

.profile-client-element--density-compact :deep(.v-field__input) {
  min-height: 34px;
}

.profile-client-element--tone-emphasized :deep(.v-avatar) {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.18);
}
</style>
