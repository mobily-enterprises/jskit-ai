<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import { useShellWindowSizeClass } from "../composables/useShellWindowSizeClass.js";
import { useShellNavigationRuntime } from "../navigation/useShellNavigation.js";

// Material 3's list-detail layout. Expanded and large windows show the list pane beside the detail pane, so the
// detail page needs no Up arrow to reach the list, and with nothing open the detail pane shows the page's own landing
// child (a placeholder) if it has one. Compact and medium windows show one pane at a time, the detail (with its arrow
// back to the list) while one is open. The detail page declares the list page as its parent.
const props = defineProps({
  // Whether a detail page is open, such as `route.name !== "settings"`.
  detailOpen: {
    type: Boolean,
    default: false
  }
});

const runtime = useShellNavigationRuntime();
const { isExpanded, isLarge } = useShellWindowSizeClass();
const twoPane = computed(() => isExpanded.value || isLarge.value);
let releaseParentPane = null;

function releasePane() {
  releaseParentPane?.();
  releaseParentPane = null;
}

watch(
  () => twoPane.value && props.detailOpen,
  (parentVisible) => {
    if (parentVisible && !releaseParentPane) {
      releaseParentPane = runtime.showParentPane();
    } else if (!parentVisible) {
      releasePane();
    }
  },
  { immediate: true }
);

onBeforeUnmount(releasePane);
</script>

<template>
  <div
    class="shell-list-detail"
    :class="{ 'shell-list-detail--two-pane': twoPane }"
    data-testid="jskit-shell-list-detail"
  >
    <section v-show="twoPane || !props.detailOpen" class="shell-list-detail__list">
      <slot name="list" />
    </section>
    <section v-if="twoPane || props.detailOpen" class="shell-list-detail__detail">
      <slot name="detail" />
    </section>
  </div>
</template>

<style scoped>
.shell-list-detail {
  display: grid;
  gap: 24px;
  grid-template-columns: minmax(0, 1fr);
}

.shell-list-detail--two-pane {
  grid-template-columns: 360px minmax(0, 1fr);
}

.shell-list-detail__list,
.shell-list-detail__detail {
  min-width: 0;
}

.shell-list-detail:not(.shell-list-detail--two-pane) .shell-list-detail__list {
  max-width: 840px;
}
</style>
