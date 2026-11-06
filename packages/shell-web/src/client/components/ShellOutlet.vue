<script setup>
import { useShellOutletPlacements } from "../composables/useShellOutletPlacements.js";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  target: {
    type: String,
    default: ""
  },
  default: {
    type: Boolean,
    default: false
  },
  context: {
    type: Object,
    default: () => ({})
  }
});

const { text } = useJskitText();
const TRANSLATED_PLACEMENT_PROPS = Object.freeze(["label", "title"]);

function isPlacementText(value) {
  return typeof value === "string" || (Boolean(value) && typeof value === "object" && typeof value.key === "string");
}

// A placement's label and title may be message keys or { key, fallback }; they
// reach the component in the active language. Plain text passes unchanged.
function placementProps(entry) {
  const translated = { ...entry.props };
  for (const name of TRANSLATED_PLACEMENT_PROPS) {
    if (isPlacementText(entry.props[name])) {
      translated[name] = text(entry.props[name]);
    }
  }
  return translated;
}

const placements = useShellOutletPlacements(() => props.target, () => props.context);
</script>

<template>
  <component
    :is="entry.component"
    v-for="entry in placements"
    :key="entry.id"
    v-bind="placementProps(entry)"
  />
</template>
