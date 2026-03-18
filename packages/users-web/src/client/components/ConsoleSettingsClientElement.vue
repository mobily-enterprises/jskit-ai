<template>
  <v-container fluid class="console-home pa-0">
    <v-row class="ma-0" justify="center">
      <v-col cols="12" sm="10" md="9" lg="7">
        <v-sheet class="pa-6 pa-sm-8" rounded="lg" border>
          <h1 class="text-h5 text-sm-h4 mb-3">Console settings</h1>
          <p class="text-body-2 text-sm-body-1 mb-0">
            No console settings are provided by <code>@jskit-ai/users-web</code>. Install a module that contributes
            forms to <code>console.settings.forms</code>.
          </p>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.console-home {
  min-height: min(100vh, 700px);
  display: grid;
  align-content: start;
  padding-top: clamp(16px, 4vh, 48px);
}
</style>
