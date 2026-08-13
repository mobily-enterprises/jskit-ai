<route lang="json">
{
  "meta": {
    "jskit": {
      "navigation": {
        "behavior": "destination",
        "destinationKey": "admin.workspace.members",
        "scope": ["principal", "surface", "workspace"],
        "persistence": { "mode": "url-only" }
      }
    }
  }
}
</route>

<template>
  <WorkspaceMembersClientElement />
</template>

<script setup>
import WorkspaceMembersClientElement from "@jskit-ai/workspaces-web/client/components/WorkspaceMembersClientElement";
</script>
