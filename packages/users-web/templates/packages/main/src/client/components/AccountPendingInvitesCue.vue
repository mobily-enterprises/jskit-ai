<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { mdiEmailAlertOutline } from "@mdi/js";
import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";

const { context: placementContext } = useWebPlacementContext();
const route = useRoute();

function normalizePendingInvitesCount(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return 0;
  }
  return numeric;
}

function resolveReturnTo() {
  const fullPath = String(route?.fullPath || "").trim();
  if (fullPath.startsWith("/") && !fullPath.startsWith("//")) {
    return fullPath;
  }
  const path = String(route?.path || "").trim();
  if (path.startsWith("/") && !path.startsWith("//")) {
    return path;
  }
  return "/";
}

function countPendingInvites(entries = []) {
  if (!Array.isArray(entries)) {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    total += 1;
  }
  return total;
}

const authenticated = computed(() => placementContext.value?.auth?.authenticated === true);

const bootstrapSummaryQuery = useQuery({
  queryKey: ["local-main", "account", "invites-cue", "bootstrap"],
  enabled: authenticated,
  staleTime: 5_000,
  refetchInterval: 15_000,
  queryFn: async () => {
    const response = await fetch("/api/bootstrap", {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Bootstrap request failed with status ${response.status}.`);
    }

    return response.json();
  }
});

const placementPendingInvitesCount = computed(() =>
  normalizePendingInvitesCount(placementContext.value?.pendingInvitesCount)
);
const bootstrapPendingInvitesCount = computed(() => {
  const payload = bootstrapSummaryQuery.data.value;
  const invitesEnabled = payload?.app?.features?.workspaceInvites === true;
  if (!invitesEnabled) {
    return 0;
  }

  return countPendingInvites(payload?.pendingInvites);
});
const pendingInvitesCount = computed(() =>
  Math.max(placementPendingInvitesCount.value, bootstrapPendingInvitesCount.value)
);

const placementWorkspaceInvitesEnabled = computed(() => placementContext.value?.workspaceInvitesEnabled === true);
const bootstrapWorkspaceInvitesEnabled = computed(() => {
  const payload = bootstrapSummaryQuery.data.value;
  return payload?.app?.features?.workspaceInvites === true;
});
const workspaceInvitesEnabled = computed(
  () => placementWorkspaceInvitesEnabled.value || bootstrapWorkspaceInvitesEnabled.value
);

const isVisible = computed(() => {
  return (
    authenticated.value &&
    workspaceInvitesEnabled.value &&
    pendingInvitesCount.value > 0
  );
});

const resolvedTo = computed(() => {
  const query = new URLSearchParams({
    section: "invites",
    returnTo: resolveReturnTo()
  });
  return appendQueryString("/account/settings", query.toString());
});
</script>

<template>
  <v-badge
    v-if="isVisible"
    color="error"
    :content="pendingInvitesCount"
    :model-value="pendingInvitesCount > 0"
    bordered
    offset-x="6"
    offset-y="8"
  >
    <v-btn
      :to="resolvedTo"
      variant="tonal"
      color="warning"
      :prepend-icon="mdiEmailAlertOutline"
      size="small"
      class="text-none"
    >
      Invites
    </v-btn>
  </v-badge>
</template>
