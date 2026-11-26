<template>
  <AuthScreen class="signout-screen" :class="{ 'signout-screen--mobile': isMobileViewport }">
    <template v-if="$slots.brand" #brand="brand">
      <slot name="brand" v-bind="brand" />
    </template>
    <v-card
      class="signout-card"
      :class="{ 'signout-card--mobile': isMobileViewport }"
      variant="flat"
      :rounded="isMobileViewport ? false : undefined"
    >
      <v-card-text class="signout-content" :class="{ 'signout-content--mobile': isMobileViewport }">
        <h1 class="signout-title mb-3" :class="text.title">{{ t("jskit.auth.signOut.title") }}</h1>

        <p v-if="status === 'pending'" class="on-surface-variant mb-4">
          {{ t("jskit.auth.signOut.pending") }}
        </p>

        <p v-if="status === 'error'" class="on-surface-variant mb-4" :class="text.lead">
          {{ errorMessage || t("jskit.auth.signOut.failedTryAgain") }}
        </p>

        <div class="d-flex ga-3">
          <UiButton
            v-if="status === 'error'"
            emphasis="high"
            class="text-none"
            @click="retrySignOut"
          >
            {{ t("jskit.auth.signOut.retry") }}
          </UiButton>
          <UiButton
            v-if="status === 'error'"
            emphasis="low"
            tone="neutral"
            class="text-none"
            @click="goToLogin"
          >
            {{ t("jskit.auth.signOut.goToLogin") }}
          </UiButton>
          <v-progress-circular v-if="status === 'pending'" indeterminate color="primary" size="22" />
        </div>
      </v-card-text>
    </v-card>
  </AuthScreen>
</template>

<script setup>
import { useDisplay } from "vuetify";
import { useShellUi } from "@jskit-ai/shell-web/client/ui";
import AuthScreen from "./AuthScreen.vue";
import { useSignOutView } from "../composables/useSignOutView.js";
import { useJskitText } from "../i18n.js";

const { mobile: isMobileViewport } = useDisplay({ mobileBreakpoint: 960 });
const { t } = useJskitText();
// The application's button and type classes, or Material 3's (shell-web's UI kit).
const { Button: UiButton, text } = useShellUi();
const { status, errorMessage, retrySignOut, goToLogin } = useSignOutView();
</script>

<style scoped>
.signout-card {
  width: min(520px, 100%);
}

/* On a phone the card is the screen below the brand row, if any. */
.signout-card--mobile {
  flex: 1 0 auto;
  width: 100%;
}

.signout-content {
  padding: 28px;
}

.signout-content--mobile {
  padding: calc(24px + var(--auth-screen-top-inset, 0px)) 20px calc(32px + env(safe-area-inset-bottom, 0px));
}
</style>
