<script setup>
import ShellPrimaryAction from "../../../src/client/components/ShellPrimaryAction.vue";

// A console page, whose navigation waits for the console session's permissions (App.vue). Its Builds button and its
// New build action are what a person reaches for as the page opens; each press is listed in window.__fixtureConsolePresses.
function press(name) {
  window.__fixtureConsolePresses = [...(window.__fixtureConsolePresses || []), name];
}
</script>

<template>
  <section>
    <p>Builds run on the console's machines.</p>
    <v-btn data-testid="fixture-console-builds" variant="tonal" @click="press('builds')">Builds</v-btn>
    <ShellPrimaryAction label="New build" data-testid="fixture-console-new-build" @click="press('new-build')" />
  </section>
</template>
