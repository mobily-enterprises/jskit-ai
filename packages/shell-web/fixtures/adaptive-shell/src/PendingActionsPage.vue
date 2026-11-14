<script setup>
import { reactive } from "vue";
import ShellPageAction from "../../../src/client/components/ShellPageAction.vue";
import ShellPageActions from "../../../src/client/components/ShellPageActions.vue";
import ShellPrimaryAction from "../../../src/client/components/ShellPrimaryAction.vue";

// Actions whose work runs until the test settles it: a page action that is `pending`, the primary page action with
// `loading` (Vuetify's progress indicator) and the screen's primary action (a FAB on compact windows) that is `pending`.
// Each press is counted, and `globalThis.settleFixtureAction(name)` ends that action's run.
const running = reactive({ sync: false, save: false, send: false });
const presses = reactive({ sync: 0, save: 0, send: 0 });

function start(name) {
  presses[name] += 1;
  running[name] = true;
}

globalThis.settleFixtureAction = (name) => {
  running[name] = false;
};
</script>

<template>
  <section class="pa-4">
    <ShellPageActions>
      <ShellPageAction
        icon="$refresh"
        :label="running.sync ? 'Syncing…' : 'Sync'"
        :pending="running.sync"
        data-testid="fixture-pending-sync"
        @click="start('sync')"
      />
      <ShellPageAction
        primary
        icon="$check"
        label="Save"
        :loading="running.save"
        data-testid="fixture-pending-save"
        @click="start('save')"
      />
    </ShellPageActions>
    <ShellPrimaryAction
      icon="$send"
      :label="running.send ? 'Sending…' : 'Send'"
      :pending="running.send"
      data-testid="fixture-pending-send"
      @click="start('send')"
    />
    <p data-testid="fixture-pending-presses">sync={{ presses.sync }} save={{ presses.save }} send={{ presses.send }}</p>
  </section>
</template>
