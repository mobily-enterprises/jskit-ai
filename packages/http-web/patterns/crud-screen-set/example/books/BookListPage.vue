<script setup>
import CrudListScreen from "@jskit-ai/http-web/client/components/CrudListScreen";
import { useCrudListScreen } from "@jskit-ai/http-web/client/composables/useCrudListScreen";
import { bookResource } from "@local/books/shared";
import { listBulkActions, listFilters, listRowActions } from "./listExtensions.js";

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
  listFilters,
  listBulkActions,
  listRowActions,
  requestRecoveryLabel: "Books",
  fallbackLoadError: "Unable to load books."
});
</script>

<template>
  <CrudListScreen
    :screen="screen"
    title-label="Books"
    heading-title="My books"
    subtitle="Search and maintain your catalogue."
    create-label="Add book"
    empty-title="No books yet"
    empty-body="Add your first book to begin the catalogue."
  >
    <template #card-fields="{ record, formatListCardValue }">
      <dl class="d-grid ga-2 mb-0">
        <div>
          <dt class="text-caption text-medium-emphasis">Author</dt>
          <dd class="text-body-2 mb-0">{{ formatListCardValue(record.author) }}</dd>
        </div>
      </dl>
    </template>

    <template #table-header>
      <th>Title</th>
      <th>Author</th>
    </template>

    <template #table-row="{ record }">
      <td>{{ record.title }}</td>
      <td>{{ record.author }}</td>
    </template>
  </CrudListScreen>
</template>
