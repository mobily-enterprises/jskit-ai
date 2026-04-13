<script setup>
import ShellOutletMenuWidget from "@jskit-ai/shell-web/client/components/ShellOutletMenuWidget";
import { WORKSPACE_TOOLS_OUTLET } from "../../shared/toolsOutletContracts.js";
</script>

<template>
  <ShellOutletMenuWidget
    :target="WORKSPACE_TOOLS_OUTLET.target"
    :default-link-component-token="WORKSPACE_TOOLS_OUTLET.defaultLinkComponentToken"
    :aria-label="WORKSPACE_TOOLS_OUTLET.ariaLabel"
  />
</template>
