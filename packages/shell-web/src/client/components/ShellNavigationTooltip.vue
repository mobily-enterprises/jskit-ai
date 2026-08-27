<script setup>
import { useTheme } from "vuetify";

const props = defineProps({
  label: {
    type: String,
    default: ""
  }
});

const theme = useTheme();
</script>

<template>
  <v-tooltip
    :text="props.label"
    :theme="theme.name.value"
    location="end"
    content-class="shell-navigation-tooltip"
    :open-delay="400"
    :open-on-focus="true"
    :open-on-hover="true"
  >
    <template #activator="{ props: activatorProps }">
      <slot :activator-props="activatorProps" />
    </template>
  </v-tooltip>
</template>

<style>
.shell-navigation-tooltip {
  background-color:
    rgb(var(--v-theme-inverse-surface, var(--v-theme-on-surface))) !important;
  color:
    rgb(var(--v-theme-inverse-on-surface, var(--v-theme-surface))) !important;
}
</style>
