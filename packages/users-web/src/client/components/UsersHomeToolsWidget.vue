<script setup>
import ShellOutletMenuWidget from "@jskit-ai/shell-web/client/components/ShellOutletMenuWidget";
import { HOME_TOOLS_OUTLET } from "../../shared/toolsOutletContracts.js";
</script>

<template>
  <ShellOutletMenuWidget
    :target="HOME_TOOLS_OUTLET.target"
    :default-link-component-token="HOME_TOOLS_OUTLET.defaultLinkComponentToken"
    :aria-label="HOME_TOOLS_OUTLET.ariaLabel"
  />
</template>
