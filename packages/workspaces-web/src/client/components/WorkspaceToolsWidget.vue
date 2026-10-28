<script setup>
import ShellOutletMenuWidget from "@jskit-ai/shell-web/client/components/ShellOutletMenuWidget";
import { ADMIN_COG_OUTLET } from "../../shared/toolsOutletContracts.js";
import { useJskitText } from "../i18n.js";

const { text } = useJskitText();
</script>

<template>
  <ShellOutletMenuWidget
    :target="ADMIN_COG_OUTLET.target"
    :aria-label="text(ADMIN_COG_OUTLET.ariaLabel)"
  />
</template>
