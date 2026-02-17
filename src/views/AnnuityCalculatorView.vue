<template>
  <section class="calculator-view py-2 py-md-4">
    <AnnuityCalculatorForm @calculated="handleCalculated" />

    <AnnuityHistoryList class="mt-6" :refresh-token="historyRefreshToken" />
  </section>
</template>

<script setup>
import { ref } from "vue";
import AnnuityCalculatorForm from "../components/annuity-calculator-form/AnnuityCalculatorForm.vue";
import AnnuityHistoryList from "../components/annuity-history-list/AnnuityHistoryList.vue";

const historyRefreshToken = ref(0);

function handleCalculated() {
  historyRefreshToken.value += 1;
}
</script>
