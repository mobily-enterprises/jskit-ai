<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useJskitText } from "../i18n.js";
import { PAGE_TITLE_ID, resolvePageTitle } from "../navigation/shellNavigationRuntime.js";
import { useShellNavigationRuntime } from "../navigation/useShellNavigation.js";

// The page's one h1, in the top app bar: the title the page sets (useShellPageTitle), else its route's
// meta.jskit.title, else `title`. The shell moves focus here after navigation. ShellLayout's bar shows it; a layout
// that draws its own top app bar renders it once in that bar. Its default slot, given `{ title }`, replaces the text
// inside the h1, such as a menu activator for a title that is also a switcher; the h1, its id and its focus stay.
const props = defineProps({
  // The title of pages that declare none and set none. A message key or plain text.
  title: {
    type: String,
    default: ""
  }
});

const { text } = useJskitText();
const route = useRoute();
const navigationRuntime = useShellNavigationRuntime();
const pageTitle = computed(() => {
  const source = navigationRuntime.pageTitleSource.value;
  const runtimeTitle = typeof source === "function" ? source() : "";
  return text(runtimeTitle) || text(resolvePageTitle(route.matched)) || text(props.title);
});
</script>

<template>
  <h1 :id="PAGE_TITLE_ID" class="shell-page-title" tabindex="-1" data-testid="jskit-shell-page-title">
    <slot :title="pageTitle">{{ pageTitle }}</slot>
  </h1>
</template>

<style scoped>
/* Material 3 small top app bar headline: title-large. */
.shell-page-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.375rem;
  font-weight: 400;
  letter-spacing: 0;
  line-height: 1.75rem;
  margin: 0;
  outline: none;
  /* Clipped sideways only, so a menu activator in the slot keeps its 48dp touch target above and below. */
  overflow-x: clip;
  overflow-y: visible;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
