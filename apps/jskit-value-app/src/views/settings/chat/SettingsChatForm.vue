<template>
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Chat settings</v-card-title>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-form @submit.prevent="actions.submitChat" novalidate>
        <v-row>
          <v-col cols="12" md="7">
            <v-text-field
              v-model="state.chatForm.publicChatId"
              label="Public chat id"
              variant="outlined"
              density="comfortable"
              maxlength="64"
              hint="Other users can use this id to start a direct message."
              persistent-hint
              :error-messages="state.chatFieldErrors.publicChatId ? [state.chatFieldErrors.publicChatId] : []"
            />
          </v-col>
        </v-row>

        <v-switch
          v-model="state.chatForm.allowWorkspaceDms"
          color="primary"
          inset
          label="Allow workspace direct messages"
          hint="Allow members in your workspace threads to direct message you."
          persistent-hint
          :error-messages="state.chatFieldErrors.allowWorkspaceDms ? [state.chatFieldErrors.allowWorkspaceDms] : []"
        />

        <v-switch
          v-model="state.chatForm.allowGlobalDms"
          color="primary"
          inset
          label="Allow global direct messages"
          hint="Allow direct messages outside workspace thread scope."
          persistent-hint
          :error-messages="state.chatFieldErrors.allowGlobalDms ? [state.chatFieldErrors.allowGlobalDms] : []"
        />

        <v-switch
          v-model="state.chatForm.requireSharedWorkspaceForGlobalDm"
          color="primary"
          inset
          label="Require shared workspace for global DM"
          hint="Only users sharing an active workspace with you can start a global DM."
          persistent-hint
          :error-messages="
            state.chatFieldErrors.requireSharedWorkspaceForGlobalDm
              ? [state.chatFieldErrors.requireSharedWorkspaceForGlobalDm]
              : []
          "
        />

        <v-switch
          v-model="state.chatForm.discoverableByPublicChatId"
          color="primary"
          inset
          label="Discoverable by public chat id"
          hint="Allow your account to appear in DM candidate search when users share a workspace with you."
          persistent-hint
          :error-messages="
            state.chatFieldErrors.discoverableByPublicChatId ? [state.chatFieldErrors.discoverableByPublicChatId] : []
          "
        />

        <v-alert v-if="state.chatFieldErrors.chat" type="error" variant="tonal" class="mb-3">
          {{ state.chatFieldErrors.chat }}
        </v-alert>

        <v-alert v-if="state.chatMessage" :type="state.chatMessageType" variant="tonal" class="mb-3">
          {{ state.chatMessage }}
        </v-alert>

        <v-btn type="submit" color="primary" :loading="state.chatMutation.isPending.value">Save chat settings</v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { useSettingsChatForm } from "./useSettingsChatForm";

const { state, actions } = useSettingsChatForm();
</script>
