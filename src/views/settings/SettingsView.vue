<template>
  <section class="settings-view py-2 py-md-4">
    <v-card class="panel-card" rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="panel-title">Account settings</v-card-title>
        <v-card-subtitle>Global profile, preferences, security, and notification controls.</v-card-subtitle>
        <template #append>
          <v-btn variant="text" color="secondary" @click="actions.goBack">Back</v-btn>
        </template>
      </v-card-item>
      <v-divider />

      <v-card-text class="pt-4">
        <v-alert v-if="state.loadError" type="error" variant="tonal" class="mb-4">
          {{ state.loadError }}
        </v-alert>

        <v-row class="settings-layout" no-gutters>
          <v-col cols="12" md="3" lg="2" class="pr-md-4 mb-4 mb-md-0">
            <v-list nav density="comfortable" class="settings-section-list rounded-lg">
              <v-list-item
                v-for="section in meta.settingsSections"
                :key="section.value"
                :title="section.title"
                :active="state.activeTab === section.value"
                rounded="lg"
                @click="actions.selectSettingsSection(section.value)"
              />
            </v-list>
          </v-col>

          <v-col cols="12" md="9" lg="10">
            <v-window v-model="state.activeTab" :touch="false" class="settings-sections-window">
              <v-window-item value="profile">
                <SettingsProfileSection
                  :meta="profile.meta"
                  :state="profile.state"
                  :actions="profile.actions"
                />
              </v-window-item>

              <v-window-item value="security">
                <SettingsSecuritySection
                  :meta="security.meta"
                  :state="security.state"
                  :actions="security.actions"
                />
              </v-window-item>

              <v-window-item value="preferences">
                <SettingsPreferencesSection
                  :meta="preferences.meta"
                  :state="preferences.state"
                  :actions="preferences.actions"
                />
              </v-window-item>

              <v-window-item value="notifications">
                <SettingsNotificationsSection
                  :meta="notifications.meta"
                  :state="notifications.state"
                  :actions="notifications.actions"
                />
              </v-window-item>
            </v-window>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { reactive } from "vue";
import { useSettingsView } from "./useSettingsView";
import SettingsSecuritySection from "./security/SettingsSecuritySection.vue";
import SettingsProfileSection from "./profile/SettingsProfileSection.vue";
import SettingsPreferencesSection from "./preferences/SettingsPreferencesSection.vue";
import SettingsNotificationsSection from "./notifications/SettingsNotificationsSection.vue";
import { useSettingsSecuritySection } from "./security/useSettingsSecuritySection";
import { useSettingsProfileSection } from "./profile/useSettingsProfileSection";
import { useSettingsPreferencesSection } from "./preferences/useSettingsPreferencesSection";
import { useSettingsNotificationsSection } from "./notifications/useSettingsNotificationsSection";

const { meta, state: rawState, actions } = useSettingsView();
const state = reactive(rawState);

const settingsView = {
  meta,
  state,
  actions
};

const security = useSettingsSecuritySection(settingsView);
const profile = useSettingsProfileSection(settingsView);
const preferences = useSettingsPreferencesSection(settingsView);
const notifications = useSettingsNotificationsSection(settingsView);

defineExpose({
  meta,
  state,
  actions
});
</script>

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
