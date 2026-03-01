<template>
  <v-main class="signout-main">
    <v-container class="fill-height d-flex align-center justify-center py-8">
      <v-card class="signout-card" rounded="lg" elevation="1" border>
        <v-card-text class="pa-7">
          <h1 class="text-h5 mb-3">Signing you out</h1>

          <p v-if="status === 'pending'" class="text-medium-emphasis mb-4">
            Please wait while we end your session.
          </p>

          <v-alert v-if="status === 'error'" type="error" variant="tonal" class="mb-4">
            {{ errorMessage || "Sign out failed. Please try again." }}
          </v-alert>

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
import { computed, onMounted, ref } from "vue";
import { performSignOutRequest } from "../../runtime/useSignOut.js";

const status = ref("pending");
const errorMessage = ref("");
const returnToPath = ref("/app");

function normalizeReturnToPath(rawValue, fallback = "/app") {
  const normalized = String(rawValue || "").trim();
  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }
  if (normalized === "/login" || normalized.startsWith("/login?")) {
    return fallback;
  }
  if (normalized === "/auth/signout" || normalized.startsWith("/auth/signout?")) {
    return fallback;
  }
  return normalized;
}

function readReturnToPathFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return "/app";
  }
  const params = new URLSearchParams(window.location.search || "");
  return normalizeReturnToPath(params.get("returnTo"), "/app");
}

const loginRoute = computed(() => {
  const params = new URLSearchParams({
    returnTo: returnToPath.value
  });
  return `/login?${params.toString()}`;
});

function navigateToLogin({ replace = true } = {}) {
  if (typeof window !== "object" || !window.location) {
    return;
  }
  if (replace) {
    window.location.replace(loginRoute.value);
    return;
  }
  window.location.assign(loginRoute.value);
}

async function executeSignOut() {
  status.value = "pending";
  errorMessage.value = "";

  try {
    await performSignOutRequest();
    status.value = "success";
    navigateToLogin({ replace: true });
  } catch (error) {
    status.value = "error";
    errorMessage.value = String(error?.message || "Sign out failed.");
  }
}

function retrySignOut() {
  void executeSignOut();
}

function goToLogin() {
  navigateToLogin({ replace: false });
}

onMounted(() => {
  returnToPath.value = readReturnToPathFromLocation();
  void executeSignOut();
});
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
