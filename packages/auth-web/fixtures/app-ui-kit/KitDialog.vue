<script setup>
import { onMounted, ref, useId, watch } from "vue";

// The application's own dialog frame: a native modal dialog with a head holding the title and a close button, a body,
// and a foot holding the actions. Escape and Close ask the page to close it (`close`), as shell-web's Dialog role says.
const props = defineProps({
  open: { type: Boolean, required: true },
  title: { type: String, required: true }
});
const emit = defineEmits(["close"]);
const element = ref(null);
const titleId = useId();

function show(open) {
  if (open && !element.value.open) element.value.showModal();
  if (!open && element.value.open) element.value.close();
}
onMounted(() => show(props.open));
watch(() => props.open, show);
</script>

<template>
  <dialog ref="element" class="kit-dialog" :aria-labelledby="titleId" @cancel.prevent="emit('close')" @close="open && emit('close')">
    <header class="kit-dialog__head">
      <h2 :id="titleId" class="kit-dialog__title">{{ title }}</h2>
      <button type="button" class="kit-dialog__close" @click="emit('close')">Close</button>
    </header>
    <template v-if="open">
      <div class="kit-dialog__body"><slot /></div>
      <footer class="kit-dialog__actions"><slot name="actions" /></footer>
    </template>
  </dialog>
</template>
