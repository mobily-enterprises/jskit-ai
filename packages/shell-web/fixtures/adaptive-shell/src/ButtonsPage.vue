<script setup>
import { ref } from "vue";

// Every button size with its 48dp touch target, a label longer than its button, a small button in the corner of a
// scroll container, rows of adjacent icon buttons, the FAB sizes and cards by variant.
const sizes = ["x-small", "small", "default", "large"];
const pressed = ref("");
</script>

<template>
  <section class="d-flex flex-column align-start ga-8 pa-6">
    <template v-for="size in sizes" :key="size">
      <div><v-btn :size="size" variant="tonal" :data-testid="`fixture-button-${size}`">Size {{ size }}</v-btn></div>
      <div><v-btn :size="size" icon="$close" :aria-label="`Close ${size}`" :data-testid="`fixture-icon-button-${size}`" /></div>
    </template>
    <!-- A table row's compact actions, touching, and a selected tab's comfortable pair, 2px apart. -->
    <div class="d-flex" data-testid="fixture-adjacent-compact">
      <v-btn
        v-for="name in ['history', 'edit', 'more']"
        :key="name"
        density="compact"
        variant="text"
        :icon="name === 'more' ? '$moreVert' : `$${name}`"
        :aria-label="name"
        :data-testid="`fixture-adjacent-${name}`"
        @click="pressed = name"
      />
    </div>
    <div class="d-flex ga-0" :style="{ columnGap: '2px' }" data-testid="fixture-adjacent-comfortable">
      <v-btn
        v-for="name in ['info', 'archive']"
        :key="name"
        density="comfortable"
        size="small"
        variant="text"
        :icon="name === 'info' ? '$info' : '$inbox'"
        :aria-label="name"
        :data-testid="`fixture-adjacent-${name}`"
        @click="pressed = name"
      />
    </div>
    <output data-testid="fixture-adjacent-pressed">{{ pressed }}</output>
    <div :style="{ width: '160px' }">
      <v-btn variant="tonal" data-testid="fixture-long-label">A label far longer than the room it has</v-btn>
    </div>
    <div class="d-flex align-end justify-end" :style="{ width: '160px', height: '32px', overflow: 'auto' }" data-testid="fixture-button-corner">
      <v-btn size="x-small" icon="$close" aria-label="Close corner" />
    </div>
    <div class="d-flex align-center ga-4">
      <v-fab icon="$add" aria-label="Add" data-testid="fixture-fab" />
      <v-fab icon="$add" size="small" aria-label="Add small" data-testid="fixture-fab-small" />
      <v-fab icon="$add" size="large" aria-label="Add large" data-testid="fixture-fab-large" />
      <v-fab extended prepend-icon="$add" text="New" data-testid="fixture-fab-extended" />
    </div>
    <div class="d-flex ga-4">
      <v-card v-for="variant in ['elevated', 'flat', 'tonal']" :key="variant" :variant="variant" :data-testid="`fixture-card-${variant}`">
        <v-card-text>{{ variant }}</v-card-text>
      </v-card>
    </div>
  </section>
</template>
