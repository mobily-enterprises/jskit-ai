<script setup>
const title = defineModel("title", { type: String, default: "" });
const author = defineModel("author", { type: String, default: "" });
const notes = defineModel("notes", { type: String, default: "" });

defineProps({
  readonly: {
    type: Boolean,
    default: false
  },
  resolveFieldErrors: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <v-col cols="12" md="6">
    <v-text-field
      v-model="title"
      label="Title"
      variant="outlined"
      density="comfortable"
      maxlength="255"
      :readonly="readonly"
      :error-messages="resolveFieldErrors('title')"
    />
  </v-col>
  <v-col cols="12" md="6">
    <v-text-field
      v-model="author"
      label="Author"
      variant="outlined"
      density="comfortable"
      maxlength="255"
      :readonly="readonly"
      :error-messages="resolveFieldErrors('author')"
    />
  </v-col>
  <v-col cols="12">
    <v-textarea
      v-model="notes"
      label="Notes"
      variant="outlined"
      density="comfortable"
      auto-grow
      :readonly="readonly"
      :error-messages="resolveFieldErrors('notes')"
    />
  </v-col>
</template>
