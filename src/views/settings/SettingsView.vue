<template>
  <section class="settings-view py-2 py-md-4">
    <v-card class="panel-card" rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="panel-title">Account settings</v-card-title>
        <v-card-subtitle>Global security, profile, preferences, and notification controls.</v-card-subtitle>
        <template #append>
          <v-btn variant="text" color="secondary" @click="vm.goBack">Back</v-btn>
        </template>
      </v-card-item>
      <v-divider />

      <v-card-text class="pt-4">
        <v-alert v-if="vm.loadError" type="error" variant="tonal" class="mb-4">
          {{ vm.loadError }}
        </v-alert>

        <v-row class="settings-layout" no-gutters>
          <v-col cols="12" md="3" lg="2" class="pr-md-4 mb-4 mb-md-0">
            <v-list nav density="comfortable" class="settings-section-list rounded-lg">
              <v-list-item
                v-for="section in vm.settingsSections"
                :key="section.value"
                :title="section.title"
                :active="vm.activeTab === section.value"
                rounded="lg"
                @click="vm.selectSettingsSection(section.value)"
              />
            </v-list>
          </v-col>

          <v-col cols="12" md="9" lg="10">
            <v-window v-model="vm.activeTab" :touch="false" class="settings-sections-window">
              <v-window-item value="security">
                <SettingsSecuritySection :vm="vm" />
              </v-window-item>

              <v-window-item value="profile">
                <SettingsProfileSection :vm="vm" />
              </v-window-item>

              <v-window-item value="preferences">
                <SettingsPreferencesSection :vm="vm" />
              </v-window-item>

              <v-window-item value="notifications">
                <SettingsNotificationsSection :vm="vm" />
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
import SettingsSecuritySection from "./SettingsSecuritySection.vue";
import SettingsProfileSection from "./SettingsProfileSection.vue";
import SettingsPreferencesSection from "./SettingsPreferencesSection.vue";
import SettingsNotificationsSection from "./SettingsNotificationsSection.vue";

const { meta, state, actions } = useSettingsView();
const vm = reactive({
  ...meta,
  ...state,
  ...actions
});

defineExpose(vm);
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
