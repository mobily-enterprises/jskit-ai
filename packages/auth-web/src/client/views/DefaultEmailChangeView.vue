<template>
  <AuthScreen class="email-change-screen">
    <template v-if="$slots.brand" #brand="brand">
      <slot name="brand" v-bind="brand" />
    </template>
    <v-card
      class="email-change-card"
      :class="{ 'email-change-card--mobile': isMobileViewport }"
      variant="flat"
      :rounded="isMobileViewport ? false : undefined"
    >
      <v-card-text class="email-change-content">
        <h1 class="mb-5" :class="text.title">{{ t("jskit.auth.emailChange.title") }}</h1>
        <v-progress-linear v-if="status === 'checking'" indeterminate color="primary" />
        <v-alert v-else :type="status === 'done' ? 'success' : 'error'" variant="tonal">
          {{ message }}
        </v-alert>
        <div v-if="status !== 'checking'" class="mt-4 d-flex justify-end">
          <UiButton emphasis="low" tone="neutral" href="/">
            {{ t("jskit.auth.emailChange.continue") }}
          </UiButton>
        </div>
      </v-card-text>
    </v-card>
  </AuthScreen>
</template>

<script setup>
import { useDisplay } from "vuetify";
import { useShellUi } from "@jskit-ai/shell-web/client/ui";
import AuthScreen from "./AuthScreen.vue";
import { useEmailChangeView } from "../composables/useEmailChangeView.js";
import { useJskitText } from "../i18n.js";

const { mobile: isMobileViewport } = useDisplay({ mobileBreakpoint: 960 });
const { t } = useJskitText();
// The application's button and type classes, or Material 3's (shell-web's UI kit).
const { Button: UiButton, text } = useShellUi();
const { status, message } = useEmailChangeView();
</script>

<style scoped>
.email-change-card {
  width: min(480px, 100%);
}

/* On a phone the card is the screen below the brand row, if any. */
.email-change-card--mobile {
  flex: 1 0 auto;
  width: 100%;
}

.email-change-content {
  padding: 28px;
}
</style>
