<script setup>
import { mdiCogOutline } from "@mdi/js";
import ShellOutlet from "./ShellOutlet.vue";
import { useJskitText } from "../i18n.js";

const { t, text } = useJskitText();

const props = defineProps({
  target: {
    type: String,
    required: true
  },
  icon: {
    type: String,
    default: mdiCogOutline
  },
  // Defaults to the translated "Tools"; a passed label may be a message key.
  ariaLabel: {
    type: String,
    default: undefined
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
        :aria-label="props.ariaLabel === undefined ? t('jskit.shell.layout.tools') : text(props.ariaLabel)"
      >
        <v-icon :icon="props.icon" />
      </v-btn>
    </template>

    <v-list :min-width="props.minWidth" density="comfortable" class="py-1">
      <ShellOutlet :target="props.target" />
    </v-list>
  </v-menu>
</template>
