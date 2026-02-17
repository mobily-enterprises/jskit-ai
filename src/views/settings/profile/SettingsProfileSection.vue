<template>
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Profile</v-card-title>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-form @submit.prevent="actions.submitProfile" novalidate>
        <v-row class="mb-2">
          <v-col cols="12" md="4" class="d-flex flex-column align-center justify-center">
            <v-avatar :size="state.preferencesForm.avatarSize" color="surface-variant" rounded="circle" class="mb-3">
              <v-img v-if="state.profileAvatar.effectiveUrl" :src="state.profileAvatar.effectiveUrl" cover />
              <span v-else class="text-h6">{{ state.profileInitials }}</span>
            </v-avatar>
            <div class="text-caption text-medium-emphasis">Preview size: {{ state.preferencesForm.avatarSize }} px</div>
          </v-col>
          <v-col cols="12" md="8">
            <div class="d-flex flex-wrap ga-2 mb-2">
              <v-btn variant="tonal" color="secondary" @click="actions.openAvatarEditor">Replace avatar</v-btn>
              <v-btn
                v-if="state.profileAvatar.hasUploadedAvatar"
                variant="text"
                color="error"
                :loading="state.avatarDeleteMutation.isPending.value"
                @click="actions.submitAvatarDelete"
              >
                Remove avatar
              </v-btn>
            </div>
            <div v-if="state.selectedAvatarFileName" class="text-caption text-medium-emphasis mb-2">
              Selected file: {{ state.selectedAvatarFileName }}
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
              label="Display name"
              variant="outlined"
              density="comfortable"
              autocomplete="nickname"
              :error-messages="state.profileFieldErrors.displayName ? [state.profileFieldErrors.displayName] : []"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="state.profileForm.email"
              label="Email"
              variant="outlined"
              density="comfortable"
              readonly
              hint="Managed by Supabase Auth"
              persistent-hint
            />
          </v-col>
        </v-row>

        <v-alert v-if="state.profileMessage" :type="state.profileMessageType" variant="tonal" class="mb-3">
          {{ state.profileMessage }}
        </v-alert>

        <v-btn type="submit" color="primary" :loading="state.profileMutation.isPending.value">Save profile</v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<script setup>
const props = defineProps({
  meta: {
    type: Object,
    required: true
  },
  state: {
    type: Object,
    required: true
  },
  actions: {
    type: Object,
    required: true
  }
});

const state = props.state;
const actions = props.actions;
</script>
