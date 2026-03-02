<template>
  <ProfileClientElement :state="state" :actions="actions" />
</template>

<script setup>
import { ProfileClientElement } from "@jskit-ai/profile-client-element/client";
import { useSettingsProfileForm } from "./useSettingsProfileForm";

const { state, actions } = useSettingsProfileForm();
</script>
