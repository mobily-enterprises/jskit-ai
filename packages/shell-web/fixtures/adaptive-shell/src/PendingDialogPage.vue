<script setup>
import { ref } from "vue";
import { vPending } from "../../../src/client/directives/vPending.js";

// A dialog's action with v-pending, in the dialog's form: Send invite runs until the test settles it, accepted
// (`globalThis.settleFixtureInvite()`) or refused with the Email field marked (`settleFixtureInvite("Already invited.")`).
const dialog = ref(false);
const sending = ref(false);
const presses = ref(0);
const name = ref("");
const email = ref("");
const emailError = ref("");

function invite() {
  presses.value += 1;
  emailError.value = "";
  sending.value = true;
}

globalThis.settleFixtureInvite = (refusal = "") => {
  emailError.value = refusal;
  sending.value = false;
};
</script>

<template>
  <section class="pa-4">
    <v-btn variant="text" data-testid="fixture-open-invite" @click="dialog = true">Invite someone</v-btn>
    <p data-testid="fixture-invite-presses">{{ presses }}</p>
    <v-dialog v-model="dialog" max-width="480">
      <v-card title="Invite someone">
        <v-form @submit.prevent="invite">
          <v-card-text>
            <v-text-field v-model="name" label="Name" />
            <v-text-field v-model="email" label="Email" :error-messages="emailError" />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="dialog = false">Cancel</v-btn>
            <v-btn v-pending="sending" type="submit" variant="text" data-testid="fixture-send-invite">
              {{ sending ? "Sending…" : "Send invite" }}
            </v-btn>
          </v-card-actions>
        </v-form>
      </v-card>
    </v-dialog>
  </section>
</template>
