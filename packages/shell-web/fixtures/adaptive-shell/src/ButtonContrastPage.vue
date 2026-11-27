<script setup>
// A button in each colour that has a container role and each variant, for its label's contrast at rest, hovered,
// focused and pressed: a state layer is drawn under the label, so it is part of what the label is read against. Each
// is there again active, as a button whose route is current or whose menu is open is drawn, with its activated layer.
const COLORS = Object.freeze(["primary", "secondary", "tertiary", "error", "success", "warning", "info"]);
const VARIANTS = Object.freeze(["flat", "elevated", "tonal", "outlined", "text"]);
</script>

<template>
  <section class="d-flex flex-column ga-2 pa-4">
    <div v-for="color in COLORS" :key="color" class="d-flex flex-wrap ga-2">
      <v-btn
        v-for="variant in VARIANTS"
        :key="variant"
        :color="color"
        :variant="variant"
        :data-testid="`contrast-${color}-${variant}`"
      >
        {{ variant }}
      </v-btn>
    </div>
    <div v-for="color in COLORS" :key="`active-${color}`" class="d-flex flex-wrap ga-2">
      <v-btn
        v-for="variant in VARIANTS"
        :key="variant"
        :color="color"
        :variant="variant"
        active
        :data-testid="`active-${color}-${variant}`"
      >
        {{ variant }}
      </v-btn>
    </div>
  </section>
</template>
