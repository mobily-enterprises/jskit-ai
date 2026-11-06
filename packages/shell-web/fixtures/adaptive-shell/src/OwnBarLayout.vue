<script setup>
import ShellPageActionsTarget from "@jskit-ai/shell-web/client/components/ShellPageActionsTarget";
import ShellPageTitle from "@jskit-ai/shell-web/client/components/ShellPageTitle";
import ShellUpButton from "@jskit-ai/shell-web/client/components/ShellUpButton";
import { useShellAppBar } from "@jskit-ai/shell-web/client/composables/useShellAppBar";

// A layout that draws its own top app bar, as a workspace bar with the app's own controls does, from the shell's
// pieces: Up, the page title and the page's actions.
useShellAppBar();
</script>

<template>
  <v-app-bar color="surface" flat :height="64" data-testid="fixture-own-bar">
    <ShellUpButton />
    <div class="flex-grow-1 px-3 text-truncate">
      <ShellPageTitle title="Studio" />
    </div>
    <ShellPageActionsTarget />
    <v-btn variant="text" data-testid="fixture-workspace-control">Workspace</v-btn>
  </v-app-bar>
  <v-main class="bg-background">
    <slot />
  </v-main>
</template>
