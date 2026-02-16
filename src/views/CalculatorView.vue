<template>
  <section class="calculator-view py-2 py-md-4">
    <AnnuityCalculatorForm @calculated="history.onCalculationCreated" />

    <AnnuityHistoryPanel
      class="mt-6"
      :page-size-options="history.pageSizeOptions"
      :error="history.error"
      :loading="history.loading"
      :entries="history.entries"
      :page="history.page"
      :total-pages="history.totalPages"
      :total="history.total"
      :page-size="history.pageSize"
      :format-date="formatDate"
      :type-label="typeLabel"
      :input-summary="inputSummary"
      :format-currency="formatCurrency"
      @refresh="history.load"
      @previous-page="history.goPrevious"
      @next-page="history.goNext"
      @page-size-change="history.onPageSizeChange"
    />
  </section>
</template>

<script setup>
import { useAnnuityHistory } from "../composables/useAnnuityHistory";
import { formatCurrency, formatDate, inputSummary, typeLabel } from "../features/annuity/presentation";
import AnnuityCalculatorForm from "../components/annuity-calculator-form/AnnuityCalculatorForm.vue";
import AnnuityHistoryPanel from "../components/AnnuityHistoryPanel.vue";

const history = useAnnuityHistory();
</script>
