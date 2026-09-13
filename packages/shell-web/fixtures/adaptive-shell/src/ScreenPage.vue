<script setup>
import { computed, ref } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const title = computed(() => String(route.meta.title || "Shell fixture"));
const answer = ref("");
const validation = ref("");
</script>

<template>
  <main tabindex="-1">
    <h1>{{ title }}</h1>
    <p>Package-owned browser fixture for the adaptive shell contract.</p>
    <form @submit.prevent="validation = 'Please review this answer.'">
      <label>Unsaved answer <input v-model="answer" name="answer"></label>
      <details>
        <summary>More details</summary>
        <p>Expanded form section.</p>
      </details>
      <button type="submit">Validate answer</button>
      <p role="status">{{ validation }}</p>
    </form>
  </main>
</template>
