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
        <h1 class="text-headline-medium mb-5">{{ t("jskit.auth.emailChange.title") }}</h1>
        <v-progress-linear v-if="status === 'checking'" indeterminate color="primary" />
        <v-alert v-else :type="status === 'done' ? 'success' : 'error'" variant="tonal">
          {{ message }}
        </v-alert>
        <div v-if="status !== 'checking'" class="mt-4 d-flex justify-end">
          <v-btn variant="text" color="secondary" href="/">
            {{ t("jskit.auth.emailChange.continue") }}
          </v-btn>
        </div>
      </v-card-text>
    </v-card>
  </AuthScreen>
</template>

<script setup>
import { useDisplay } from "vuetify";
import AuthScreen from "./AuthScreen.vue";
import { useDefaultEmailChangeView } from "../composables/useDefaultEmailChangeView.js";
import { useJskitText } from "../i18n.js";

const { mobile: isMobileViewport } = useDisplay({ mobileBreakpoint: 960 });
const { t } = useJskitText();
const { status, message } = useDefaultEmailChangeView();
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
