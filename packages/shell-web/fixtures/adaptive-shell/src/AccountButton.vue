<script setup>
import { computed, watch } from "vue";
import { useShellTopRightLabels } from "../../../src/client/composables/useShellTopRightLabels.js";

// The account item an app puts in the bar's corner, drawn as auth-web's AuthProfileWidget draws it: the name beside
// the avatar where the bar shows its items' labels (useShellTopRightLabels), else a round button named by the initials
// and the name. It counts each change of that choice in window.__fixtureAccountLabels, so a test can tell the bar
// settles rather than switching back and forth.
const props = defineProps({
  name: {
    type: String,
    required: true
  }
});

const { showsLabels } = useShellTopRightLabels();
const initials = computed(() => props.name.split(/\s+/u).slice(0, 2).map((word) => word[0]).join("").toUpperCase());

watch(showsLabels, () => {
  window.__fixtureAccountLabels = (window.__fixtureAccountLabels || 0) + 1;
});
</script>

<template>
  <v-btn v-if="showsLabels" variant="text" class="text-none pl-1 pr-2" data-testid="fixture-account">
    <v-avatar size="32" color="primary" variant="tonal">
      <span class="text-body-small font-weight-medium">{{ initials }}</span>
    </v-avatar>
    <span class="fixture-account__name ml-2 text-body-medium" data-testid="fixture-account-name">{{ props.name }}</span>
  </v-btn>
  <v-btn v-else icon variant="text" :aria-label="`${initials} ${props.name}`" data-testid="fixture-account">
    <v-avatar size="32" color="primary" variant="tonal" aria-hidden="true">
      <span class="text-body-small font-weight-medium">{{ initials }}</span>
    </v-avatar>
  </v-btn>
</template>

<style scoped>
.fixture-account__name {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
