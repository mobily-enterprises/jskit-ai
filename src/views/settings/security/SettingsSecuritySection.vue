<template>
  <v-row>
    <v-col cols="12" md="7">
      <v-card rounded="lg" elevation="0" border>
        <v-card-item>
          <v-card-title class="text-subtitle-1">Authentication methods</v-card-title>
          <v-card-subtitle>Enable, disable, and manage how this account signs in.</v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <div v-if="state.authMethodItems.length > 0" class="d-flex flex-column ga-3">
            <div
              v-for="method in state.authMethodItems"
              :key="method.id"
              class="d-flex flex-wrap align-center justify-space-between ga-3"
            >
              <div>
                <div class="text-body-2 font-weight-medium">{{ method.label }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ actions.authMethodStatusText(method) }}
                </div>
              </div>

              <div class="d-flex flex-wrap justify-end ga-2">
                <template v-if="method.kind === meta.AUTH_METHOD_KIND_PASSWORD">
                  <v-btn
                    v-if="method.enabled || !method.configured"
                    variant="text"
                    color="secondary"
                    @click="actions.openPasswordForm"
                  >
                    {{ state.passwordManageLabel }}
                  </v-btn>
                  <v-btn
                    v-if="method.enabled"
                    variant="text"
                    color="error"
                    :disabled="!method.canDisable"
                    :loading="state.methodActionLoadingId === method.id && state.setPasswordMethodEnabledMutation.isPending.value"
                    @click="actions.submitPasswordMethodToggle(false)"
                  >
                    Disable
                  </v-btn>
                  <v-btn
                    v-else-if="method.configured"
                    variant="tonal"
                    color="secondary"
                    :disabled="!method.canEnable"
                    @click="actions.openPasswordEnableSetup"
                  >
                    Enable
                  </v-btn>
                </template>

                <template v-else-if="method.kind === meta.AUTH_METHOD_KIND_OAUTH">
                  <v-btn
                    v-if="method.enabled"
                    variant="text"
                    color="error"
                    :disabled="!method.canDisable"
                    :loading="state.methodActionLoadingId === method.id && state.unlinkProviderMutation.isPending.value"
                    @click="actions.submitProviderUnlink(method.provider)"
                  >
                    Unlink
                  </v-btn>
                  <v-btn
                    v-else
                    variant="tonal"
                    color="secondary"
                    :disabled="state.providerLinkStartInFlight"
                    @click="actions.startProviderLink(method.provider)"
                  >
                    Link
                  </v-btn>
                </template>

                <template v-else-if="method.kind === meta.AUTH_METHOD_KIND_OTP">
                  <v-chip size="small" label color="secondary">Required</v-chip>
                </template>
              </div>
            </div>
          </div>
          <p v-else class="text-body-2 text-medium-emphasis mb-0">
            No user-managed sign-in methods are available yet.
          </p>

          <p class="text-caption text-medium-emphasis mt-3 mb-0">{{ state.securityMethodsHint }}</p>

          <v-alert v-if="state.providerMessage" :type="state.providerMessageType" variant="tonal" class="mt-3 mb-0">
            {{ state.providerMessage }}
          </v-alert>

          <v-dialog v-model="state.showPasswordForm" max-width="560">
            <v-card rounded="lg" border>
              <v-card-item>
                <v-card-title class="text-subtitle-1">{{ state.passwordDialogTitle }}</v-card-title>
                <v-card-subtitle v-if="state.isPasswordEnableSetupMode">
                  Set a new password, then click Enable to turn password sign-in on.
                </v-card-subtitle>
              </v-card-item>
              <v-divider />
              <v-card-text>
                <v-form @submit.prevent="actions.submitPasswordChange" novalidate>
                  <v-text-field
                    v-if="state.requiresCurrentPassword"
                    v-model="state.securityForm.currentPassword"
                    label="Current password"
                    :type="state.showCurrentPassword ? 'text' : 'password'"
                    :append-inner-icon="state.showCurrentPassword ? 'mdi-eye-off' : 'mdi-eye'"
                    @click:append-inner="state.showCurrentPassword = !state.showCurrentPassword"
                    variant="outlined"
                    density="comfortable"
                    autocomplete="current-password"
                    :error-messages="state.securityFieldErrors.currentPassword ? [state.securityFieldErrors.currentPassword] : []"
                    class="mb-3"
                  />

                  <v-text-field
                    v-model="state.securityForm.newPassword"
                    label="New password"
                    :type="state.showNewPassword ? 'text' : 'password'"
                    :append-inner-icon="state.showNewPassword ? 'mdi-eye-off' : 'mdi-eye'"
                    @click:append-inner="state.showNewPassword = !state.showNewPassword"
                    variant="outlined"
                    density="comfortable"
                    autocomplete="new-password"
                    :error-messages="state.securityFieldErrors.newPassword ? [state.securityFieldErrors.newPassword] : []"
                    class="mb-3"
                  />

                  <v-text-field
                    v-model="state.securityForm.confirmPassword"
                    label="Confirm new password"
                    :type="state.showConfirmPassword ? 'text' : 'password'"
                    :append-inner-icon="state.showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
                    @click:append-inner="state.showConfirmPassword = !state.showConfirmPassword"
                    variant="outlined"
                    density="comfortable"
                    autocomplete="new-password"
                    :error-messages="state.securityFieldErrors.confirmPassword ? [state.securityFieldErrors.confirmPassword] : []"
                    class="mb-3"
                  />

                  <v-alert v-if="state.securityMessage" :type="state.securityMessageType" variant="tonal" class="mb-3">
                    {{ state.securityMessage }}
                  </v-alert>

                  <div class="d-flex flex-wrap ga-2">
                    <v-btn type="submit" color="primary" :loading="state.passwordFormSubmitPending">
                      {{ state.passwordFormSubmitLabel }}
                    </v-btn>
                    <v-btn variant="text" color="secondary" @click="actions.closePasswordForm">Cancel</v-btn>
                  </div>
                </v-form>
              </v-card-text>
            </v-card>
          </v-dialog>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" md="5">
      <v-card rounded="lg" elevation="0" border class="mb-4">
        <v-card-item>
          <v-card-title class="text-subtitle-1">Active sessions</v-card-title>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-3">
            Sign out all other devices while keeping this session active.
          </p>

          <v-btn
            color="secondary"
            variant="outlined"
            :loading="state.logoutOthersMutation.isPending.value"
            @click="actions.submitLogoutOthers"
          >
            Sign out other devices
          </v-btn>

          <v-alert v-if="state.sessionsMessage" :type="state.sessionsMessageType" variant="tonal" class="mt-3 mb-0">
            {{ state.sessionsMessage }}
          </v-alert>
        </v-card-text>
      </v-card>

      <v-card rounded="lg" elevation="0" border>
        <v-card-item>
          <v-card-title class="text-subtitle-1">MFA status</v-card-title>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <v-chip :color="state.mfaChipColor" label>{{ state.mfaLabel }}</v-chip>
          <p class="text-body-2 text-medium-emphasis mt-3 mb-0">
            Multi-factor enrollment UI is scaffolded as read-only in this version.
          </p>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup>
import { useSettingsSecuritySectionView } from "./useSettingsSecuritySectionView";

const { meta, state, actions } = useSettingsSecuritySectionView();
</script>
