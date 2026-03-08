<template>
  <section class="workspace-settings-client-element">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">Workspace settings</v-card-title>
        <v-card-subtitle>These values apply to everyone in this workspace.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
          {{ loadError }}
        </v-alert>

        <v-alert v-else-if="!canViewWorkspaceSettings" type="warning" variant="tonal" class="mb-4">
          You do not have permission to view workspace settings.
        </v-alert>

        <template v-else>
          <v-form @submit.prevent="submitWorkspaceSettings" novalidate>
            <v-row>
              <v-col cols="12" md="5">
                <v-text-field
                  v-model="workspaceForm.name"
                  label="Workspace name"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!canManageWorkspaceSettings || saving"
                  :error-messages="fieldErrors.name ? [fieldErrors.name] : []"
                />
              </v-col>

              <v-col cols="12" md="2">
                <v-text-field
                  v-model="workspaceForm.color"
                  label="Workspace color"
                  type="color"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!canManageWorkspaceSettings || saving"
                  :error-messages="fieldErrors.color ? [fieldErrors.color] : []"
                />
              </v-col>

              <v-col cols="12" md="5">
                <v-text-field
                  v-model="workspaceForm.avatarUrl"
                  label="Workspace avatar URL"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!canManageWorkspaceSettings || saving"
                  placeholder="https://..."
                  hint="Optional"
                  persistent-hint
                  :error-messages="fieldErrors.avatarUrl ? [fieldErrors.avatarUrl] : []"
                />
              </v-col>

              <v-col cols="12" md="6" class="d-flex align-center">
                <v-switch
                  v-model="workspaceForm.invitesEnabled"
                  color="primary"
                  hide-details
                  label="Enable invites"
                  :disabled="!canManageWorkspaceSettings || !workspaceForm.invitesAvailable || saving"
                />
              </v-col>

              <v-col cols="12">
                <v-textarea
                  v-model="workspaceForm.appDenyEmailsText"
                  label="App surface deny list (emails)"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!canManageWorkspaceSettings || saving"
                  hint="Optional. One email per line. Denied users cannot access this workspace on the app surface."
                  persistent-hint
                  rows="4"
                  auto-grow
                  :error-messages="fieldErrors.appDenyEmails ? [fieldErrors.appDenyEmails] : []"
                />
              </v-col>

              <v-col cols="12">
                <v-textarea
                  v-model="workspaceForm.appDenyUserIdsText"
                  label="App surface deny list (user IDs)"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!canManageWorkspaceSettings || saving"
                  hint="Optional. One user ID per line. Denied users cannot access this workspace on the app surface."
                  persistent-hint
                  rows="3"
                  auto-grow
                  :error-messages="fieldErrors.appDenyUserIds ? [fieldErrors.appDenyUserIds] : []"
                />
              </v-col>

              <v-col cols="12" class="d-flex align-center justify-end ga-3">
                <v-progress-circular v-if="loading" size="18" indeterminate />
                <v-btn
                  v-if="canManageWorkspaceSettings"
                  type="submit"
                  color="primary"
                  :loading="saving"
                  :disabled="loading"
                >
                  Save workspace settings
                </v-btn>
                <v-chip v-else color="secondary" label>Read-only</v-chip>
              </v-col>
            </v-row>
          </v-form>

          <v-alert v-if="workspaceMessage" :type="workspaceMessageType" variant="tonal" class="mt-4 mb-0">
            {{ workspaceMessage }}
          </v-alert>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import {
  useWebPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceApiPathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";

const client = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

const loading = ref(false);
const saving = ref(false);
const loadError = ref("");
const workspaceMessage = ref("");
const workspaceMessageType = ref("success");
const permissions = ref([]);
const route = useRoute();
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();

const currentSurfaceId = computed(() => resolveSurfaceIdFromPlacementPathname(placementContext.value, route.path));
const workspaceSettingsApiPath = computed(() =>
  resolveSurfaceApiPathFromPlacementContext(placementContext.value, currentSurfaceId.value, "/workspace/settings")
);
const routeWorkspaceSlug = computed(() =>
  extractWorkspaceSlugFromSurfacePathname(placementContext.value, currentSurfaceId.value, route.path)
);

const fieldErrors = reactive({
  name: "",
  avatarUrl: "",
  color: "",
  appDenyEmails: "",
  appDenyUserIds: ""
});

const workspaceForm = reactive({
  name: "",
  color: "#0F6B54",
  avatarUrl: "",
  invitesEnabled: false,
  invitesAvailable: false,
  appDenyEmailsText: "",
  appDenyUserIdsText: ""
});

function resetFieldErrors() {
  fieldErrors.name = "";
  fieldErrors.avatarUrl = "";
  fieldErrors.color = "";
  fieldErrors.appDenyEmails = "";
  fieldErrors.appDenyUserIds = "";
}

function applyFieldErrors(source = {}) {
  const fieldErrorMap = source && typeof source === "object" ? source : {};
  fieldErrors.name = String(fieldErrorMap.name || "");
  fieldErrors.avatarUrl = String(fieldErrorMap.avatarUrl || "");
  fieldErrors.color = String(fieldErrorMap.color || "");
  fieldErrors.appDenyEmails = String(fieldErrorMap.appDenyEmails || "");
  fieldErrors.appDenyUserIds = String(fieldErrorMap.appDenyUserIds || "");
}

function parseDenyEmailsInput(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\n,;]+/)
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function parseDenyUserIdsInput(value) {
  const rawValues = String(value || "")
    .split(/[\n,;]+/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  const valid = [];
  const invalid = [];

  for (const rawValue of rawValues) {
    if (!/^[1-9]\d*$/.test(rawValue)) {
      invalid.push(rawValue);
      continue;
    }

    const numeric = Number(rawValue);
    if (!Number.isSafeInteger(numeric) || numeric < 1) {
      invalid.push(rawValue);
      continue;
    }

    valid.push(numeric);
  }

  return Object.freeze({
    valid: Array.from(new Set(valid)),
    invalid: Array.from(new Set(invalid))
  });
}

function formatDenyEmails(value) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
}

function formatDenyUserIds(value) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0)
    .join("\n");
}

function applyShellPermissions(permissionList) {
  mergePlacementContext(
    {
      permissions: permissionList
    },
    "users-web.workspace-settings-view"
  );
}

function applyWorkspaceSettingsPayload(payload = {}) {
  const workspace = payload?.workspace && typeof payload.workspace === "object" ? payload.workspace : {};
  const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};

  const appSurfaceAccess =
    settings.appSurfaceAccess && typeof settings.appSurfaceAccess === "object" ? settings.appSurfaceAccess : {};

  workspaceForm.name = String(workspace.name || "");
  workspaceForm.color = String(workspace.color || "#0F6B54");
  workspaceForm.avatarUrl = String(workspace.avatarUrl || "");
  workspaceForm.invitesEnabled = settings.invitesEnabled !== false;
  workspaceForm.invitesAvailable = settings.invitesAvailable !== false;
  workspaceForm.appDenyEmailsText = formatDenyEmails(
    Array.isArray(settings.appDenyEmails) ? settings.appDenyEmails : appSurfaceAccess.denyEmails
  );
  workspaceForm.appDenyUserIdsText = formatDenyUserIds(
    Array.isArray(settings.appDenyUserIds) ? settings.appDenyUserIds : appSurfaceAccess.denyUserIds
  );
}

const canViewWorkspaceSettings = computed(() => {
  return (
    hasPermission(permissions.value, "workspace.settings.view") ||
    hasPermission(permissions.value, "workspace.settings.update")
  );
});

const canManageWorkspaceSettings = computed(() => {
  return hasPermission(permissions.value, "workspace.settings.update");
});

async function refreshPermissions() {
  const payload = await client.request("/api/bootstrap", {
    method: "GET"
  });

  const nextPermissions = normalizePermissionList(payload?.permissions);
  permissions.value = nextPermissions;
  applyShellPermissions(nextPermissions);
}

async function selectWorkspaceFromRouteIfPresent() {
  const workspaceSlugFromRoute = String(routeWorkspaceSlug.value || "").trim();
  if (!workspaceSlugFromRoute) {
    return;
  }

  await client.request("/api/workspaces/select", {
    method: "POST",
    body: {
      workspaceSlug: workspaceSlugFromRoute
    }
  });
}

async function loadWorkspaceSettings() {
  loading.value = true;
  loadError.value = "";
  workspaceMessage.value = "";
  resetFieldErrors();

  try {
    await selectWorkspaceFromRouteIfPresent();

    await refreshPermissions();

    if (!canViewWorkspaceSettings.value) {
      return;
    }

    const payload = await client.request(workspaceSettingsApiPath.value, {
      method: "GET"
    });

    applyWorkspaceSettingsPayload(payload);
  } catch (error) {
    loadError.value = String(error?.message || "Unable to load workspace settings.").trim();
  } finally {
    loading.value = false;
  }
}

async function submitWorkspaceSettings() {
  if (!canManageWorkspaceSettings.value || saving.value) {
    return;
  }

  saving.value = true;
  workspaceMessage.value = "";
  resetFieldErrors();

  try {
    const parsedDenyUserIds = parseDenyUserIdsInput(workspaceForm.appDenyUserIdsText);
    if (parsedDenyUserIds.invalid.length > 0) {
      fieldErrors.appDenyUserIds = `Invalid user IDs: ${parsedDenyUserIds.invalid.join(", ")}`;
      workspaceMessageType.value = "error";
      workspaceMessage.value = "Fix invalid workspace deny-list user IDs and try again.";
      return;
    }

    const payload = await client.request(workspaceSettingsApiPath.value, {
      method: "PATCH",
      body: {
        name: workspaceForm.name,
        color: workspaceForm.color,
        avatarUrl: workspaceForm.avatarUrl,
        invitesEnabled: workspaceForm.invitesEnabled,
        appDenyEmails: parseDenyEmailsInput(workspaceForm.appDenyEmailsText),
        appDenyUserIds: parsedDenyUserIds.valid
      }
    });

    applyWorkspaceSettingsPayload(payload);

    workspaceMessageType.value = "success";
    workspaceMessage.value = "Workspace settings updated.";
  } catch (error) {
    applyFieldErrors(error?.details?.fieldErrors);
    workspaceMessageType.value = "error";
    workspaceMessage.value = String(error?.message || "Unable to update workspace settings.").trim();
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadWorkspaceSettings();
});
</script>
