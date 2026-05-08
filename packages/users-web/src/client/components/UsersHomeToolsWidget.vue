<script setup>
import ShellOutletMenuWidget from "@jskit-ai/shell-web/client/components/ShellOutletMenuWidget";
import { HOME_COG_OUTLET } from "../../shared/toolsOutletContracts.js";
</script>

<template>
  <ShellOutletMenuWidget
    :target="HOME_COG_OUTLET.target"
    :aria-label="HOME_COG_OUTLET.ariaLabel"
  />
</template>
