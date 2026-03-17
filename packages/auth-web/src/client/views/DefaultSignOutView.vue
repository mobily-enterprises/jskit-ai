<template>
  <v-main class="signout-main">
    <v-container class="fill-height d-flex align-center justify-center py-8">
      <v-card class="signout-card" rounded="lg" elevation="1" border>
        <v-card-text class="pa-7">
          <h1 class="text-h5 mb-3">Signing you out</h1>

          <p v-if="status === 'pending'" class="text-medium-emphasis mb-4">
            Please wait while we end your session.
          </p>

          <p v-if="status === 'error'" class="text-body-1 text-medium-emphasis mb-4">
            {{ errorMessage || "Sign out failed. Please try again." }}
          </p>

          <div class="d-flex ga-3">
            <v-btn
              v-if="status === 'error'"
              color="primary"
              variant="flat"
              class="text-none"
              @click="retrySignOut"
            >
              Retry sign out
            </v-btn>
            <v-btn
              v-if="status === 'error'"
              color="secondary"
              variant="text"
              class="text-none"
              @click="goToLogin"
            >
              Go to login
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

const { status, errorMessage, retrySignOut, goToLogin } = useDefaultSignOutView();
</script>

<style scoped>
.signout-main {
  background-color: rgb(var(--v-theme-background));
  background-image: radial-gradient(circle at 15% 12%, rgba(0, 107, 83, 0.12), transparent 32%);
}

.signout-card {
  width: min(520px, 100%);
}
</style>
