<script setup>
import { mdiCogOutline } from "@mdi/js";
import ShellOutlet from "./ShellOutlet.vue";

const props = defineProps({
  target: {
    type: String,
    required: true
  },
  defaultLinkComponentToken: {
    type: String,
    default: ""
  },
  icon: {
    type: String,
    default: mdiCogOutline
  },
  ariaLabel: {
    type: String,
    default: "Tools"
  },
  location: {
    type: String,
    default: "bottom end"
  },
  offset: {
    type: [Number, String],
    default: 10
  },
  minWidth: {
    type: [Number, String],
    default: 220
  }
});
</script>

<template>
  <v-menu :location="props.location" :offset="props.offset" eager>
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        icon
        variant="text"
        :aria-label="props.ariaLabel"
      >
        <v-icon :icon="props.icon" />
      </v-btn>
    </template>

    <v-list :min-width="props.minWidth" density="comfortable" class="py-1">
      <ShellOutlet
        :target="props.target"
        :default-link-component-token="props.defaultLinkComponentToken"
      />
    </v-list>
  </v-menu>
</template>
