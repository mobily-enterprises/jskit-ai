<template>
  <section class="console-billing-plans-view py-2 py-md-4">
    <ConsoleBillingPlansClientElement :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { ConsoleBillingPlansClientElement } from "@jskit-ai/billing-console-admin-client-element";
import { useConsoleBillingPlansView } from "./useConsoleBillingPlansView.js";

const { meta, state, actions } = useConsoleBillingPlansView();
</script>
