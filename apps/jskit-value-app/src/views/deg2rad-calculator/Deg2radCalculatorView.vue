<template>
  <section class="calculator-view py-2 py-md-4" data-calculator="DEG2RAD">
    <Deg2radCalculatorForm @calculated="actions.handleCalculated" />
    <Deg2radHistoryList class="mt-6" :refresh-token="refreshToken" />
  </section>
</template>

<script setup>
import { toRefs } from "vue";
import Deg2radCalculatorForm from "../../components/deg2rad-calculator-form/Deg2radCalculatorForm.vue";
import Deg2radHistoryList from "../../components/deg2rad-history-list/Deg2radHistoryList.vue";
import { useDeg2radCalculatorView } from "./useDeg2radCalculatorView";

const { history, actions } = useDeg2radCalculatorView();
const { refreshToken } = toRefs(history);
</script>
