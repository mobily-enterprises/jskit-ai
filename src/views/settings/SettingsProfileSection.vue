<template>
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Profile</v-card-title>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-form @submit.prevent="vm.submitProfile" novalidate>
        <v-row class="mb-2">
          <v-col cols="12" md="4" class="d-flex flex-column align-center justify-center">
            <v-avatar :size="vm.preferencesForm.avatarSize" color="surface-variant" rounded="circle" class="mb-3">
              <v-img v-if="vm.profileAvatar.effectiveUrl" :src="vm.profileAvatar.effectiveUrl" cover />
              <span v-else class="text-h6">{{ vm.profileInitials }}</span>
            </v-avatar>
            <div class="text-caption text-medium-emphasis">Preview size: {{ vm.preferencesForm.avatarSize }} px</div>
          </v-col>
          <v-col cols="12" md="8">
            <div class="d-flex flex-wrap ga-2 mb-2">
              <v-btn variant="tonal" color="secondary" @click="vm.openAvatarEditor">Replace avatar</v-btn>
              <v-btn
                v-if="vm.profileAvatar.hasUploadedAvatar"
                variant="text"
                color="error"
                :loading="vm.avatarDeleteMutation.isPending.value"
                @click="vm.submitAvatarDelete"
              >
                Remove avatar
              </v-btn>
            </div>
            <div v-if="vm.selectedAvatarFileName" class="text-caption text-medium-emphasis mb-2">
              Selected file: {{ vm.selectedAvatarFileName }}
            </div>

            <v-alert v-if="vm.avatarMessage" :type="vm.avatarMessageType" variant="tonal" class="mb-0">
              {{ vm.avatarMessage }}
            </v-alert>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="vm.profileForm.displayName"
              label="Display name"
              variant="outlined"
              density="comfortable"
              autocomplete="nickname"
              :error-messages="vm.profileFieldErrors.displayName ? [vm.profileFieldErrors.displayName] : []"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="vm.profileForm.email"
              label="Email"
              variant="outlined"
              density="comfortable"
              readonly
              hint="Managed by Supabase Auth"
              persistent-hint
            />
          </v-col>
        </v-row>

        <v-alert v-if="vm.profileMessage" :type="vm.profileMessageType" variant="tonal" class="mb-3">
          {{ vm.profileMessage }}
        </v-alert>

        <v-btn type="submit" color="primary" :loading="vm.profileMutation.isPending.value">Save profile</v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<script setup>
defineProps({
  vm: {
    type: Object,
    required: true
  }
});
</script>
