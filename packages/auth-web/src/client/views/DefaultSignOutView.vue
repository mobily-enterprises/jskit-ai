<template>
  <v-main class="signout-main">
    <v-container class="fill-height d-flex align-center justify-center py-8">
      <v-card class="signout-card" rounded="lg" elevation="1" border>
        <v-card-text class="pa-7">
          <h1 class="text-h5 mb-3">{{ t("jskit.auth.signOut.title") }}</h1>

          <p v-if="status === 'pending'" class="text-medium-emphasis mb-4">
            {{ t("jskit.auth.signOut.pending") }}
          </p>

          <p v-if="status === 'error'" class="text-body-1 text-medium-emphasis mb-4">
            {{ errorMessage || t("jskit.auth.signOut.failedTryAgain") }}
          </p>

          <div class="d-flex ga-3">
            <v-btn
              v-if="status === 'error'"
              color="primary"
              variant="flat"
              class="text-none"
              @click="retrySignOut"
            >
              {{ t("jskit.auth.signOut.retry") }}
            </v-btn>
            <v-btn
              v-if="status === 'error'"
              color="secondary"
              variant="text"
              class="text-none"
              @click="goToLogin"
            >
              {{ t("jskit.auth.signOut.goToLogin") }}
            </v-btn>
            <v-progress-circular v-if="status === 'pending'" indeterminate color="primary" size="22" />
          </div>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>

<script setup>
import { useDefaultSignOutView } from "../composables/useDefaultSignOutView.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();
const { status, errorMessage, retrySignOut, goToLogin } = useDefaultSignOutView();
</script>

<style scoped>
.signout-main {
  background-color: rgb(var(--v-theme-background));
  background-image: radial-gradient(circle at 15% 12%, rgba(var(--v-theme-primary), 0.14), transparent 32%);
}

.signout-card {
  width: min(520px, 100%);
}
</style>
