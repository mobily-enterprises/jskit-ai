<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import ShellListDetail from "@jskit-ai/shell-web/client/components/ShellListDetail";
import ShellPageAction from "@jskit-ai/shell-web/client/components/ShellPageAction";
import ShellPageActions from "@jskit-ai/shell-web/client/components/ShellPageActions";
import { useShellPageTitle } from "@jskit-ai/shell-web/client/composables/useShellPageTitle";
import { useShellWindowSizeClass } from "@jskit-ai/shell-web/client/composables/useShellWindowSizeClass";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useShellNavigation } from "@jskit-ai/shell-web/client/navigation/useShellNavigation";
import { useAccountSettingsRuntime } from "../composables/useAccountSettingsRuntime.js";
import { useAccountSettingsSections } from "../account-settings/sections.js";
import { useJskitText } from "../i18n.js";

const { t, text } = useJskitText();
const runtime = useAccountSettingsRuntime();
const route = useRoute();
const paths = usePaths();
const sections = useAccountSettingsSections();
// The app bar carries the page's title. Its Up arrow, on a page that declares a parent, is the way out; a Done action
// beside it would be a second back control. Done shows only where Up can't take the person back: a page without a
// parent, an open section beside the list on a wide window (the list is the parent, already in view), or a returnTo
// on another of the app's origins.
useShellPageTitle(() => t("jskit.users.accountSettings.title"));
const { canGoUp } = useShellNavigation();
const doneTarget = computed(() => runtime.backNavigationTarget.value);
const showsDone = computed(() => !canGoUp.value || !doneTarget.value.sameOrigin);
const sectionValues = computed(() => Object.freeze(sections.value.map((section) => section.value)));
const defaultSection = computed(() => {
  if (sectionValues.value.includes("profile")) {
    return "profile";
  }

  return sectionValues.value[0] || "";
});

// Sections are pages: the surface's "/" is the list (/account) and "/<section>" one section (/account/preferences),
// the app's src/pages/account/[section].vue, whose parent is the list. Compact and medium windows show one pane at a
// time, so the list leads to a section and Up returns to it; wide windows show the list beside the open section, or
// beside the first section on the list's own page.
const openSection = computed(() => {
  const value = route.params?.section;
  const section = String(Array.isArray(value) ? value[0] : value || "").trim().toLowerCase();
  return sectionValues.value.includes(section) ? section : "";
});
const { isExpanded, isLarge } = useShellWindowSizeClass();
const shownSection = computed(() => {
  const value = openSection.value || (isExpanded.value || isLarge.value ? defaultSection.value : "");
  return sections.value.find((section) => section.value === value) || null;
});

// A section's page keeps the address's returnTo, where Done leads.
function sectionTarget(value) {
  const returnTo = route.query?.returnTo;
  return { path: paths.page(`/${value}`), query: returnTo ? { returnTo } : {} };
}
</script>

<template>
  <section class="settings-view py-2 py-md-4">
    <ShellPageActions v-if="showsDone">
      <ShellPageAction
        :label="t('jskit.users.accountSettings.done')"
        :to="doneTarget.sameOrigin ? doneTarget.href : undefined"
        :href="doneTarget.sameOrigin ? undefined : doneTarget.href"
      />
    </ShellPageActions>
    <div class="settings-panel">
      <p class="settings-panel__intro text-body-medium on-surface-variant">
        {{ t("jskit.users.accountSettings.subtitle") }}
      </p>

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
          <ShellListDetail :detail-open="Boolean(openSection)">
            <template #list>
              <v-list nav class="settings-section-list">
                <v-list-item
                  v-for="section in sections"
                  :key="section.value"
                  class="settings-section-list__item"
                  :title="text(section.title)"
                  :to="sectionTarget(section.value)"
                  :active="shownSection?.value === section.value"
                />
              </v-list>
            </template>
            <template #detail>
              <div v-if="shownSection" :key="shownSection.value" class="settings-section-detail">
                <component
                  :is="shownSection.component"
                  v-bind="shownSection.usesSharedRuntime ? { runtime } : undefined"
                />
              </div>
            </template>
          </ShellListDetail>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-panel {
  overflow: hidden;
}

.settings-panel__intro {
  margin: 0;
  padding: 1rem 1rem 0;
}

.settings-panel__body {
  padding: 1rem;
}

/* The selected section is Material 3's pill indicator in secondary-container, as the shell's navigation draws it, and
   its hover and pressed state layers take the same pill. */
.settings-section-list__item {
  --v-activated-opacity: 0;
  border-radius: 9999px;
  min-height: 56px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.settings-section-list__item.v-list-item--active {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

/* Material 3's navigation item label (label-large), not Vuetify's 13px nav list title. */
.settings-section-list__item :deep(.v-list-item-title) {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.00625rem;
  line-height: 1.25rem;
}

.settings-panel__state {
  margin-inline: auto;
  max-width: 30rem;
  padding: 2rem 1rem;
  text-align: center;
}
</style>
