<script setup>
import { computed, inject } from "vue";
import { JSKIT_NAVIGATION_RUNTIME_KEY } from "@jskit-ai/kernel/client/navigation";

defineProps({
  stayLabel: {
    type: String,
    default: "Stay"
  },
  discardLabel: {
    type: String,
    default: "Discard changes"
  }
});

const navigation = inject(JSKIT_NAVIGATION_RUNTIME_KEY, null);
if (!navigation?.blockerState) {
  throw new Error("ShellNavigationGuardDialog requires JSKIT navigation blocker support.");
}

const open = computed(() => navigation.blockerState.pending === true);
const title = computed(() => navigation.blockerState.title || "Discard changes?");
const message = computed(() => navigation.blockerState.message || "Your unsaved changes will be lost.");

function stay() {
  navigation.cancelBlockedNavigation();
}

function discard() {
  navigation.confirmBlockedNavigation();
}

function restoreTriggerFocus() {
  navigation.restoreBlockedNavigationFocus();
}
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="480"
    persistent
    scrollable
    data-testid="jskit-navigation-guard-dialog"
    @keydown.esc.stop.prevent="stay"
    @after-leave="restoreTriggerFocus"
  >
    <v-card role="alertdialog" aria-labelledby="jskit-navigation-guard-title" aria-describedby="jskit-navigation-guard-message">
      <v-card-title id="jskit-navigation-guard-title">{{ title }}</v-card-title>
      <v-card-text id="jskit-navigation-guard-message" class="text-body-1">
        {{ message }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" autofocus @click="stay">{{ stayLabel }}</v-btn>
        <v-btn color="error" variant="flat" @click="discard">{{ discardLabel }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
