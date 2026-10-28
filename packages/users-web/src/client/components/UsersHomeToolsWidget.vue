<script setup>
import ShellOutletMenuWidget from "@jskit-ai/shell-web/client/components/ShellOutletMenuWidget";
import { HOME_COG_OUTLET } from "../../shared/toolsOutletContracts.js";
import { useJskitText } from "../i18n.js";

const { text } = useJskitText();
</script>

<template>
  <ShellOutletMenuWidget
    :target="HOME_COG_OUTLET.target"
    :aria-label="text(HOME_COG_OUTLET.ariaLabel)"
  />
</template>
