<script setup>
const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});

const profile = props.runtime.profile;
</script>

<template>
  <v-sheet rounded="lg" border class="account-settings-section">
    <header class="account-settings-section__header">
      <h2 class="account-settings-section__title">Profile</h2>
    </header>
    <div class="account-settings-section__body">
      <v-form @submit.prevent="profile.submit" novalidate>
        <v-row class="mb-2">
          <v-col cols="12" md="4" class="d-flex flex-column align-center justify-center">
            <v-avatar :size="profile.avatar.size" color="surface-variant" rounded="circle" class="mb-3">
              <v-img v-if="profile.avatar.effectiveUrl" :src="profile.avatar.effectiveUrl" cover />
              <span v-else class="text-h6">{{ profile.initials.value }}</span>
            </v-avatar>
            <div class="text-caption text-medium-emphasis">Preview size: {{ profile.avatar.size }} px</div>
          </v-col>

          <v-col cols="12" md="8">
            <div class="d-flex flex-wrap ga-2 mb-2">
              <v-btn
                variant="tonal"
                color="secondary"
                :disabled="profile.isSaving.value || profile.isDeletingAvatar.value || profile.isRefreshing.value"
                @click="profile.openAvatarEditor"
              >
                Replace avatar
              </v-btn>
              <v-btn
                v-if="profile.avatar.hasUploadedAvatar"
                variant="text"
                color="error"
                :loading="profile.isDeletingAvatar.value"
                :disabled="profile.isSaving.value || profile.isRefreshing.value"
                @click="profile.removeAvatar"
              >
                Remove avatar
              </v-btn>
            </div>

            <div v-if="profile.selectedAvatarFileName.value" class="text-caption text-medium-emphasis mb-2">
              Selected file: {{ profile.selectedAvatarFileName.value }}
            </div>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="profile.form.displayName"
              label="Display name"
              variant="outlined"
              density="comfortable"
              autocomplete="nickname"
              :readonly="profile.isSaving.value || profile.isRefreshing.value"
              :error-messages="profile.fieldErrors.displayName ? [profile.fieldErrors.displayName] : []"
            />
          </v-col>

          <v-col cols="12" md="6">
            <v-text-field
              v-model="profile.form.email"
              label="Email"
              variant="outlined"
              density="comfortable"
              readonly
              hint="Managed by Supabase Auth"
              persistent-hint
            />
          </v-col>
        </v-row>

        <v-btn
          type="submit"
          color="primary"
          :loading="profile.isSaving.value"
          :disabled="profile.isDeletingAvatar.value || profile.isRefreshing.value"
        >
          Save profile
        </v-btn>
      </v-form>
    </div>
  </v-sheet>
</template>

<style scoped>
.account-settings-section {
  overflow: hidden;
}

.account-settings-section__header {
  padding: 1rem 1rem 0;
}

.account-settings-section__title {
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.2;
  margin: 0;
}

.account-settings-section__body {
  padding: 1rem;
}

@media (max-width: 640px) {
  .account-settings-section__body :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
