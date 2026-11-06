<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { normalizeOneOf } from "@jskit-ai/kernel/shared/support/normalize";
import { useAccountSettingsRuntime } from "../composables/useAccountSettingsRuntime.js";
import { useAccountSettingsSections } from "../account-settings/sections.js";
import { useJskitText } from "../i18n.js";

const { t, text } = useJskitText();
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
    <div class="settings-panel">
      <header class="settings-panel__header">
        <div>
          <h1 class="settings-panel__title text-headline-small">{{ t("jskit.users.accountSettings.title") }}</h1>
          <p class="text-body-medium on-surface-variant mb-0">
            {{ t("jskit.users.accountSettings.subtitle") }}
          </p>
        </div>
        <v-btn
          variant="text"
          color="secondary"
          :to="runtime.backNavigationTarget.value.sameOrigin ? runtime.backNavigationTarget.value.href : undefined"
          :href="runtime.backNavigationTarget.value.sameOrigin ? undefined : runtime.backNavigationTarget.value.href"
        >
          {{ t("jskit.users.accountSettings.back") }}
        </v-btn>
      </header>

      <div class="settings-panel__body">
        <template v-if="runtime.loadingSettings.value">
          <v-skeleton-loader type="text@2, list-item-two-line@4" class="mb-4" />
          <v-skeleton-loader type="text@2, paragraph, button" />
        </template>
        <div v-else-if="runtime.settingsLoadError.value" class="settings-panel__state">
          <h2 class="text-title-large mb-2">{{ t("jskit.users.accountSettings.loadFailedTitle") }}</h2>
          <p class="text-body-medium on-surface-variant mb-4">{{ runtime.settingsLoadError.value }}</p>
          <v-btn
            color="primary"
            variant="tonal"
            :loading="runtime.refreshingSettings.value"
            @click="runtime.refreshSettings"
          >
            {{ t("jskit.users.accountSettings.retry") }}
          </v-btn>
        </div>
        <template v-else-if="sections.length < 1">
          <p class="text-body-medium on-surface-variant mb-0">{{ t("jskit.users.accountSettings.noSections") }}</p>
        </template>
        <template v-else>
          <v-progress-linear v-if="runtime.refreshingSettings.value" indeterminate class="mb-4" />
          <v-row class="settings-layout" no-gutters>
            <v-col cols="12" md="3" lg="2" class="pr-md-4 mb-4 mb-md-0">
              <v-list nav class="settings-section-list">
                <v-list-item
                  v-for="section in sections"
                  :key="section.value"
                  :title="text(section.title)"
                  :active="activeTab === section.value"
                  @click="activeTab = section.value"
                />
              </v-list>
            </v-col>

            <v-col cols="12" md="9" lg="10">
              <v-window v-model="activeTab" :touch="false" class="settings-sections-window">
                <v-window-item
                  v-for="section in sections"
                  :key="section.value"
                  :value="section.value"
                  :transition="false"
                  :reverse-transition="false"
                >
                  <component
                    :is="section.component"
                    v-bind="section.usesSharedRuntime ? { runtime } : undefined"
                  />
                </v-window-item>
              </v-window>
            </v-col>
          </v-row>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-panel {
  overflow: hidden;
}

.settings-panel__header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding: 1rem 1rem 0;
}

.settings-panel__title {
  margin: 0 0 0.35rem;
}

.settings-panel__body {
  padding: 1rem;
}

.settings-panel__state {
  margin-inline: auto;
  max-width: 30rem;
  padding: 2rem 1rem;
  text-align: center;
}

@media (max-width: 960px) {
  .settings-panel__header {
    flex-direction: column;
  }
}
</style>
