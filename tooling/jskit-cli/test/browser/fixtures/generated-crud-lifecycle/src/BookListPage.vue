<script setup>
import CrudListScreen from "@jskit-ai/http-web/client/components/CrudListScreen";
import { useCrudListScreen } from "@jskit-ai/http-web/client/composables/useCrudListScreen";
import { bookResource } from "./bookFixture.js";

const screen = useCrudListScreen({
  resource: bookResource,
  resourceNamespace: "books",
  apiSuffix: "/books",
  recordIdParam: "bookId",
  recordIdSelector: (book = {}) => book.id,
  titleFallbackFieldKey: "title",
  viewUrlTemplate: "/books/:bookId",
  editUrlTemplate: "/books/:bookId/edit",
  newUrlTemplate: "/books/new",
  requestRecoveryLabel: "Books",
  fallbackLoadError: "Unable to load books."
});
</script>

<template>
  <CrudListScreen
    :screen="screen"
    title-label="Books"
    heading-title="Books"
    subtitle="Search, review, and update Books from this screen."
    create-label="New Book"
    empty-title="No books yet"
    empty-body="Create the first Book to start using this workflow."
  >
    <template #card-fields="{ record, formatListCardValue }">
      <div class="ui-generator-list-card__field">
        <span class="ui-generator-list-card__field-label">Title</span>
        <span class="ui-generator-list-card__field-value">
          {{ formatListCardValue(record.title) }}
        </span>
      </div>
    </template>

    <template #table-header>
      <th>Title</th>
    </template>

    <template #table-row="{ record }">
      <td>{{ record.title }}</td>
    </template>
  </CrudListScreen>
</template>
