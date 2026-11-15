<script setup>
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import ShellPrimaryAction from "../../../src/client/components/ShellPrimaryAction.vue";

// Dialogs over a page, for the page behind them: a note card with its Edit button and a link, and the FAB, whose
// "Invite" opens a dialog from v-model with no activator. The dialog is as tall as a form that fills most of a phone,
// so its "Send invitation" sits where the FAB is. In it: a select (a menu over the dialog), "Copy link" (a snackbar
// while the dialog is open), "Remove access" (a second dialog over the first) and "Open contacts" (a link that leaves
// the page with the dialog open). "Note details" opens a dialog from its activator; "Report a problem" opens the
// shell's own error dialog. The note's "Archive note" and the dialog's "Remove access" each have a tooltip and open a
// dialog. Presses of the note's Edit and the dialogs' actions are counted.
const errorRuntime = useShellWebErrorRuntime();
const invite = ref(false);
const removeAccess = ref(false);
const archive = ref(false);
const role = ref("Viewer");
const presses = ref([]);

function press(name) {
  presses.value.push(name);
}

function copyLink() {
  press("copy");
  errorRuntime.report({
    source: "fixture.notes.copy",
    message: "Invitation link copied.",
    intent: "action-feedback",
    severity: "success",
    channel: "snackbar"
  });
}

function reportProblem() {
  errorRuntime.report({
    source: "fixture.notes.problem",
    message: "The note could not be shared.",
    severity: "error",
    channel: "dialog"
  });
}
</script>

<template>
  <section class="d-flex flex-column ga-4 pa-4">
    <v-card title="Kitchen note" data-testid="fixture-note">
      <v-card-text>Order more flour before Friday.</v-card-text>
      <v-card-actions>
        <v-btn icon="$edit" variant="text" aria-label="Edit note" data-testid="fixture-note-edit" @click="press('edit')" />
        <RouterLink to="/home/contacts" data-testid="fixture-note-link">Supplier contacts</RouterLink>
        <v-btn icon variant="text" aria-label="Archive note" data-testid="fixture-note-archive" @click="archive = true">
          <v-icon icon="$delete" />
          <v-tooltip activator="parent" location="top" text="Archive note" />
        </v-btn>
      </v-card-actions>
    </v-card>

    <div class="d-flex flex-wrap ga-2">
      <v-dialog max-width="400" aria-label="Note details">
        <template #activator="{ props: activator }">
          <v-btn variant="text" data-testid="fixture-note-details" v-bind="activator">Note details</v-btn>
        </template>
        <template #default="{ isActive }">
          <v-card title="Note details" data-testid="fixture-details-dialog">
            <v-card-text>Written on Monday.</v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn variant="text" data-testid="fixture-details-close" @click="isActive.value = false">Close</v-btn>
            </v-card-actions>
          </v-card>
        </template>
      </v-dialog>
      <v-btn variant="text" data-testid="fixture-report-problem" @click="reportProblem">Report a problem</v-btn>
    </div>
    <p data-testid="fixture-notes-presses">{{ presses.join(",") }}</p>

    <v-dialog v-model="invite" max-width="480" height="600" aria-label="Invite someone">
      <v-card title="Invite someone" data-testid="fixture-invite-dialog">
        <v-card-text class="d-flex flex-column ga-2">
          <v-select v-model="role" label="Role" :items="['Viewer', 'Editor', 'Owner']" data-testid="fixture-invite-role" />
          <div class="d-flex flex-wrap ga-2">
            <v-btn variant="text" data-testid="fixture-invite-copy" @click="copyLink">Copy link</v-btn>
            <v-btn variant="text" data-testid="fixture-invite-remove" @click="removeAccess = true">
              Remove access
              <v-tooltip activator="parent" location="top" text="Asks before removing" />
            </v-btn>
            <v-btn variant="text" to="/home/contacts" data-testid="fixture-invite-contacts">Open contacts</v-btn>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="fixture-invite-cancel" @click="invite = false">Cancel</v-btn>
          <v-btn variant="text" data-testid="fixture-invite-send" @click="press('send'); invite = false">Send invitation</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="removeAccess" max-width="320" aria-label="Remove access?">
      <v-card title="Remove access?" data-testid="fixture-remove-dialog">
        <v-card-text>They can no longer open this note.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="fixture-remove-keep" @click="removeAccess = false">Keep</v-btn>
          <v-btn variant="text" data-testid="fixture-remove-confirm" @click="press('remove'); removeAccess = false">Remove</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="archive" max-width="320" aria-label="Archive this note?">
      <v-card title="Archive this note?" data-testid="fixture-archive-dialog">
        <v-card-text>It leaves the list of notes.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="fixture-archive-cancel" @click="archive = false">Cancel</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ShellPrimaryAction label="Invite" icon="$add" data-testid="fixture-invite" @click="invite = true" />
  </section>
</template>
