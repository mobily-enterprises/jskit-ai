<template>
  <section class="settings-view py-2 py-md-4">
    <v-card class="panel-card" rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="panel-title">Account settings</v-card-title>
        <v-card-subtitle>Global profile, preferences, security, and notification controls.</v-card-subtitle>
        <template #append>
          <v-btn variant="text" color="secondary" @click="page.actions.goBack">Back</v-btn>
        </template>
      </v-card-item>
      <v-divider />

      <v-card-text class="pt-4">
        <v-alert v-if="page.state.loadError" type="error" variant="tonal" class="mb-4">
          {{ page.state.loadError }}
        </v-alert>

        <v-row class="settings-layout" no-gutters>
          <v-col cols="12" md="3" lg="2" class="pr-md-4 mb-4 mb-md-0">
            <v-list nav density="comfortable" class="settings-section-list rounded-lg">
              <v-list-item
                v-for="section in page.meta.settingsSections"
                :key="section.value"
                :title="section.title"
                :active="page.state.activeTab === section.value"
                rounded="lg"
                @click="page.actions.selectSettingsSection(section.value)"
              />
            </v-list>
          </v-col>

          <v-col cols="12" md="9" lg="10">
            <v-window v-model="page.state.activeTab" :touch="false" class="settings-sections-window">
              <v-window-item value="profile">
                <SettingsProfileSection />
              </v-window-item>

              <v-window-item value="security">
                <SettingsSecuritySection />
              </v-window-item>

              <v-window-item value="preferences">
                <SettingsPreferencesSection />
              </v-window-item>

              <v-window-item value="notifications">
                <SettingsNotificationsSection />
              </v-window-item>
            </v-window>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useSettingsView } from "./useSettingsView";
import { provideSettingsContext } from "./useSettingsContext";
import SettingsSecuritySection from "./security/SettingsSecuritySection.vue";
import SettingsProfileSection from "./profile/SettingsProfileSection.vue";
import SettingsPreferencesSection from "./preferences/SettingsPreferencesSection.vue";
import SettingsNotificationsSection from "./notifications/SettingsNotificationsSection.vue";

const { page, sections } = useSettingsView();
provideSettingsContext({
  sections
});

defineExpose({
  page,
  sections
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
