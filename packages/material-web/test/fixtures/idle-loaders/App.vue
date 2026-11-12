<script setup>
import { defineComponent, h, nextTick, ref, shallowRef, watch } from "vue";

// `?view=fields` mounts fields on request and counts the layout reads their idle loaders make
// (vuetifyjs/vuetify#23393); `?view=loaders` shows a loading field, a circular progress and, below the fold, an
// indeterminate bar.
const view = new URLSearchParams(window.location.search).get("view");
const shownCount = ref(0);
const list = ref();

// getBoundingClientRect() calls while fields mount: on a progress bar (the loaders') or on anything else.
const reads = { on: false, progress: 0, other: 0 };
const getBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function countedGetBoundingClientRect() {
  if (reads.on) {
    if (this.classList?.contains("v-progress-linear")) reads.progress += 1;
    else reads.other += 1;
  }
  return getBoundingClientRect.call(this);
};

// A row part that writes a style on the list when its element appears, as row code often does: after each write, the
// next field's read lays the page out again.
const RowStamp = defineComponent({
  props: { index: { type: Number, required: true } },
  setup(props) {
    const element = shallowRef();
    watch(element, (node) => {
      if (node) list.value.style.setProperty("--rows-mounted", String(props.index));
    });
    return () => h("span", { ref: element, class: "stamp" });
  }
});

window.mountFields = async (count) => {
  Object.assign(reads, { on: true, progress: 0, other: 0 });
  const started = performance.now();
  shownCount.value = count;
  await nextTick();
  const milliseconds = performance.now() - started;
  reads.on = false;
  return { progressReads: reads.progress, otherReads: reads.other, milliseconds };
};
</script>

<template>
  <v-app>
    <div v-if="view === 'fields'" ref="list">
      <div v-for="row in shownCount" :key="row" class="field-row">
        <v-text-field :label="`Field ${row}`" density="compact" hide-details />
        <RowStamp :index="row" />
      </div>
    </div>
    <div v-else>
      <div data-testid="loading-field">
        <v-text-field label="Loading" loading />
      </div>
      <div data-testid="circular">
        <v-progress-circular indeterminate />
      </div>
      <div class="below-fold" data-testid="below-fold">
        <v-progress-linear indeterminate />
      </div>
    </div>
  </v-app>
</template>

<style>
.field-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.stamp { min-width: 64px; }
.below-fold { margin-top: 200vh; }
</style>
