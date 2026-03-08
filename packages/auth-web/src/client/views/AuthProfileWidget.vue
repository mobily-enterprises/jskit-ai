<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useAuthGuardRuntime } from "../runtime/inject.js";

const props = defineProps({
  surface: {
    type: String,
    default: "*"
  }
});

const authGuardRuntime = useAuthGuardRuntime({
  required: true
});
const authState = ref(authGuardRuntime.getState());
const { context: shellPlacementContext } = useWebPlacementContext();
let unsubscribe = null;

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

  const username = String(authState.value?.username || "").trim();
  if (username) {
    return username;
  }

  return "Guest";
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
    auth: authState.value,
    user: shellUser.value
  };
});

async function refreshProfileState() {
  authState.value = await authGuardRuntime.refresh();
}

onMounted(() => {
  unsubscribe = authGuardRuntime.subscribe((nextState) => {
    authState.value = nextState;
  });
  void refreshProfileState();
});

onBeforeUnmount(() => {
  if (typeof unsubscribe === "function") {
    unsubscribe();
    unsubscribe = null;
  }
});
</script>

<template>
  <v-menu location="bottom end" offset="10">
    <template #activator="{ props }">
      <v-btn v-bind="props" variant="text" class="text-none pl-1 pr-2">
        <v-avatar size="32" color="primary" variant="tonal">
          <v-img v-if="avatarUrl" :src="avatarUrl" cover />
          <span v-else class="text-caption font-weight-medium">{{ initials }}</span>
        </v-avatar>
        <span class="ml-2 d-none d-sm-inline text-body-2">{{ displayName }}</span>
      </v-btn>
    </template>

    <v-list min-width="220" density="comfortable" class="py-1">
      <ShellOutlet
        :surface="props.surface"
        placement="avatar.primary-menu"
        :context="placementContext"
      />
    </v-list>
  </v-menu>
</template>
