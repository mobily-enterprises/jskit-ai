<script setup>
import { ref } from "vue";
import { vPending } from "../../../src/client/directives/vPending.js";

// A dialog's action with v-pending, in the dialog's form: Send invite runs until the test settles it, accepted
// (`globalThis.settleFixtureInvite()`) or refused with a field marked: Email (`settleFixtureInvite("Already invited.")`)
// or the Plan radio group, whose first choice, the current plan, is disabled (`settleFixtureInvite(message, "plan")`).
const dialog = ref(false);
const sending = ref(false);
const presses = ref(0);
const name = ref("");
const email = ref("");
const emailError = ref("");
const plan = ref("current");
const planError = ref("");

function invite() {
  presses.value += 1;
  emailError.value = "";
  planError.value = "";
  sending.value = true;
}

globalThis.settleFixtureInvite = (refusal = "", field = "email") => {
  emailError.value = field === "email" ? refusal : "";
  planError.value = field === "plan" ? refusal : "";
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
            <v-radio-group v-model="plan" label="Plan" :error-messages="planError">
              <v-radio label="Current plan" value="current" disabled />
              <v-radio label="Larger plan" value="larger" />
            </v-radio-group>
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
