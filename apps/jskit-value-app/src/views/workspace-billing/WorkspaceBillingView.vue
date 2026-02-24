<template>
  <section class="workspace-billing-view py-2 py-md-4">
    <BillingPlanClientElement :meta="meta" :state="state" :actions="actions" />
    <BillingCommerceClientElement :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { BillingPlanClientElement } from "@jskit-ai/billing-plan-client-element";
import { BillingCommerceClientElement } from "@jskit-ai/billing-commerce-client-element";
import { useWorkspaceBillingView } from "./useWorkspaceBillingView.js";

const { meta, state, actions } = useWorkspaceBillingView();
</script>
