<template>
  <section class="console-billing-products-view py-2 py-md-4">
    <ConsoleBillingProductsClientElement :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { ConsoleBillingProductsClientElement } from "@jskit-ai/billing-console-admin-client-element";
import { useConsoleBillingProductsView } from "./useConsoleBillingProductsView.js";

const { meta, state, actions } = useConsoleBillingProductsView();
</script>
