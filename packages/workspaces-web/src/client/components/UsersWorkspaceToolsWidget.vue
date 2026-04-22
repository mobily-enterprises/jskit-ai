<script setup>
import ShellOutletMenuWidget from "@jskit-ai/shell-web/client/components/ShellOutletMenuWidget";
import { ADMIN_COG_OUTLET } from "../../shared/toolsOutletContracts.js";
</script>

<template>
  <ShellOutletMenuWidget
    :target="ADMIN_COG_OUTLET.target"
    :default-link-component-token="ADMIN_COG_OUTLET.defaultLinkComponentToken"
    :aria-label="ADMIN_COG_OUTLET.ariaLabel"
  />
</template>
