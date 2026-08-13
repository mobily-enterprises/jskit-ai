<route lang="json">
{
  "meta": {
    "jskit": {
      "navigation": {
        "behavior": "destination",
        "destinationKey": "console.settings",
        "scope": ["principal", "surface"],
        "persistence": { "mode": "url-only" }
      }
    }
  }
}
</route>

<template>
  <section class="console-settings-empty">
    <h2 class="text-h6 mb-2" data-jskit-page-heading tabindex="-1">No console settings yet</h2>
    <p class="text-body-2 text-medium-emphasis mb-0">
      Console settings sections will appear here when installed.
    </p>
  </section>
</template>

<style scoped>
.console-settings-empty {
  margin-inline: auto;
  max-width: 34rem;
  padding: 2rem 1.25rem;
  text-align: center;
}
</style>
