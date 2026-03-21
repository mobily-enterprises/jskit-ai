<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAccountSettingsRuntime } from "@jskit-ai/users-web/client/composables/useAccountSettingsRuntime";
import AccountSettingsProfileSection from "./AccountSettingsProfileSection.vue";
import AccountSettingsPreferencesSection from "./AccountSettingsPreferencesSection.vue";
import AccountSettingsNotificationsSection from "./AccountSettingsNotificationsSection.vue";
import AccountSettingsInvitesSection from "./AccountSettingsInvitesSection.vue";

const runtime = useAccountSettingsRuntime();
const route = useRoute();
const router = useRouter();

const sections = Object.freeze([
  { title: "Profile", value: "profile" },
  { title: "Preferences", value: "preferences" },
  { title: "Notifications", value: "notifications" },
  { title: "Invites", value: "invites" }
]);
const sectionValues = new Set(sections.map((section) => section.value));

function normalizeSection(value) {
  const source = Array.isArray(value) ? value[0] : value;
  const normalized = String(source || "").trim().toLowerCase();
  if (!sectionValues.has(normalized)) {
    return "profile";
  }
  return normalized;
}

function readRouteSection() {
  return normalizeSection(route?.query?.section);
}

const activeTab = computed({
  get() {
    return readRouteSection();
  },
  set(nextValue) {
    const normalizedSection = normalizeSection(nextValue);
    const currentSection = readRouteSection();
    if (normalizedSection === currentSection) {
      return;
    }

    const nextQuery = {
      ...route.query
    };
    if (normalizedSection === "profile") {
      delete nextQuery.section;
    } else {
      nextQuery.section = normalizedSection;
    }

    void router.replace({
      query: nextQuery
    });
  }
});
</script>

<template>
  <section class="settings-view py-2 py-md-4">
    <v-card class="panel-card" rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="panel-title">Account settings</v-card-title>
        <v-card-subtitle>Global profile, preferences, notifications, and invitation controls.</v-card-subtitle>
        <template #append>
          <v-btn
            variant="text"
            color="secondary"
            :to="runtime.backNavigationTarget.value.sameOrigin ? runtime.backNavigationTarget.value.href : undefined"
            :href="runtime.backNavigationTarget.value.sameOrigin ? undefined : runtime.backNavigationTarget.value.href"
          >
            Back
          </v-btn>
        </template>
      </v-card-item>
      <v-divider />

      <v-card-text class="pt-4">
        <template v-if="runtime.loadingSettings.value">
          <v-skeleton-loader type="text@2, list-item-two-line@4" class="mb-4" />
          <v-skeleton-loader type="text@2, paragraph, button" />
        </template>
        <template v-else>
          <v-progress-linear v-if="runtime.refreshingSettings.value" indeterminate class="mb-4" />
          <v-row class="settings-layout" no-gutters>
            <v-col cols="12" md="3" lg="2" class="pr-md-4 mb-4 mb-md-0">
              <v-list nav density="comfortable" class="settings-section-list rounded-lg">
                <v-list-item
                  v-for="section in sections"
                  :key="section.value"
                  :title="section.title"
                  :active="activeTab === section.value"
                  rounded="lg"
                  @click="activeTab = section.value"
                />
              </v-list>
            </v-col>

            <v-col cols="12" md="9" lg="10">
              <v-window v-model="activeTab" :touch="false" class="settings-sections-window">
                <v-window-item value="profile">
                  <AccountSettingsProfileSection :runtime="runtime" />
                </v-window-item>

                <v-window-item value="preferences">
                  <AccountSettingsPreferencesSection :runtime="runtime" />
                </v-window-item>

                <v-window-item value="notifications">
                  <AccountSettingsNotificationsSection :runtime="runtime" />
                </v-window-item>

                <v-window-item value="invites">
                  <AccountSettingsInvitesSection :runtime="runtime" />
                </v-window-item>
              </v-window>
            </v-col>
          </v-row>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<style scoped>
.panel-card {
  background-color: rgb(var(--v-theme-surface));
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.settings-section-list {
  border: 1px solid rgba(var(--v-theme-outline), 0.35);
}

:deep(.settings-section-list .v-list-item--active) {
  background-color: rgba(var(--v-theme-primary), 0.14);
}

:deep(.settings-sections-window .v-window-x-transition-enter-active),
:deep(.settings-sections-window .v-window-x-transition-leave-active),
:deep(.settings-sections-window .v-window-x-reverse-transition-enter-active),
:deep(.settings-sections-window .v-window-x-reverse-transition-leave-active) {
  transition: none !important;
}
</style>
