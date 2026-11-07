<script setup>
import { computed } from "vue";
import { useDisplay } from "vuetify";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useAuthStore } from "../stores/useAuthStore.js";
import { useJskitText } from "../i18n.js";

const auth = useAuthStore();
const { t } = useJskitText();
const { context: shellPlacementContext } = useWebPlacementContext();
// Beside the name the activator is a pill; on a phone, without it, a round icon button around the avatar.
const { smAndUp: showsName } = useDisplay();

const shellUser = computed(() => {
  const user = shellPlacementContext.value?.user;
  if (!user || typeof user !== "object") {
    return {};
  }
  return user;
});

const displayName = computed(() => {
  const fromContext = String(shellUser.value.displayName || shellUser.value.name || "").trim();
  if (fromContext) {
    return fromContext;
  }

  const username = String(auth.username || "").trim();
  if (username) {
    return username;
  }

  return t("jskit.auth.profile.guest");
});

const avatarUrl = computed(() => {
  const value = String(shellUser.value.avatarUrl || shellUser.value.avatar || "").trim();
  return value;
});

const initials = computed(() => {
  const text = String(displayName.value || "").trim();
  if (!text) {
    return "G";
  }

  const words = text
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (words.length > 1) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return text.slice(0, 2).toUpperCase();
});

const placementContext = computed(() => {
  return {
    auth: auth.authState,
    user: shellUser.value
  };
});
</script>

<template>
  <v-menu location="bottom end" offset="10">
    <template #activator="{ props }">
      <v-btn
        v-if="showsName"
        v-bind="props"
        variant="text"
        class="auth-profile-widget__activator text-none pl-1 pr-2"
      >
        <v-avatar size="32" color="primary" variant="tonal">
          <v-img v-if="avatarUrl" :src="avatarUrl" cover />
          <span v-else class="text-body-small font-weight-medium">{{ initials }}</span>
        </v-avatar>
        <span class="ml-2 text-body-medium">{{ displayName }}</span>
      </v-btn>
      <v-btn v-else v-bind="props" icon variant="text" class="auth-profile-widget__activator" :aria-label="displayName">
        <v-avatar size="32" color="primary" variant="tonal">
          <v-img v-if="avatarUrl" :src="avatarUrl" cover />
          <span v-else class="text-body-small font-weight-medium">{{ initials }}</span>
        </v-avatar>
      </v-btn>
    </template>

    <v-list min-width="220" density="comfortable" class="py-1">
      <ShellOutlet
        target="auth-profile-menu:primary-menu"
        :context="placementContext"
      />
    </v-list>
  </v-menu>
</template>
