<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { normalizeOneOf } from "@jskit-ai/kernel/shared/support/normalize";
import { useAccountSettingsRuntime } from "../composables/useAccountSettingsRuntime.js";
import { useAccountSettingsSections } from "../account-settings/sections.js";

const runtime = useAccountSettingsRuntime();
const route = useRoute();
const router = useRouter();
const sections = useAccountSettingsSections();
const sectionValues = computed(() => Object.freeze(sections.value.map((section) => section.value)));
const defaultSection = computed(() => {
  if (sectionValues.value.includes("profile")) {
    return "profile";
  }

  return sectionValues.value[0] || "";
});

function normalizeSection(value) {
  const source = Array.isArray(value) ? value[0] : value;
  return normalizeOneOf(source, sectionValues.value, defaultSection.value);
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
    if (!normalizedSection || normalizedSection === currentSection) {
      return;
    }

    const nextQuery = {
      ...route.query
    };
    if (normalizedSection === defaultSection.value) {
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
        <v-card-subtitle>Global profile, preferences, notifications, and account controls.</v-card-subtitle>
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
        <template v-else-if="sections.length < 1">
          <p class="text-body-2 text-medium-emphasis mb-0">No account settings sections are registered.</p>
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
                <v-window-item v-for="section in sections" :key="section.value" :value="section.value">
                  <component
                    :is="section.component"
                    v-bind="section.usesSharedRuntime ? { runtime } : undefined"
                  />
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
