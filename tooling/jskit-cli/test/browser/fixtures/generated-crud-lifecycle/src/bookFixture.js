import { ref } from "vue";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const books = ref([]);
const deleteRequestCount = ref(0);
let nextBookId = 1;

const bookResource = defineCrudResource({
  namespace: "books",
  tableName: "books",
  schema: {
    title: {
      type: "string",
      required: true,
      maxLength: 120,
      operations: {
        output: { required: true },
        create: { required: true },
        patch: { required: false }
      }
    }
  }
});

const bookFormFields = Object.freeze([
  Object.freeze({
    key: "title",
    label: "Title",
    type: "string",
    format: "",
    nullable: false,
    relation: null,
    inputType: "text",
    component: "text",
    maxLength: 120
  })
]);

function cloneBook(book) {
  return book ? { ...book } : null;
}

function findBook(recordId) {
  return books.value.find((book) => book.id === recordId) || null;
}

function requireBook(recordId) {
  const book = findBook(recordId);
  if (book) {
    return book;
  }

  const error = new Error(`Book ${recordId} was not found.`);
  error.status = 404;
  throw error;
}

const bookClient = Object.freeze({
  async request(path, options = {}) {
    const pathname = new URL(String(path || ""), "http://fixture.invalid").pathname;
    const match = pathname.match(/^\/api\/books(?:\/([^/]+))?$/u);
    if (!match) {
      throw new Error(`Unexpected fixture request path: ${pathname}`);
    }

    const method = String(options.method || "GET").toUpperCase();
    const recordId = decodeURIComponent(match[1] || "");

    if (method === "GET" && !recordId) {
      return {
        items: books.value.map(cloneBook),
        nextCursor: null
      };
    }

    if (method === "GET") {
      return cloneBook(requireBook(recordId));
    }

    if (method === "POST" && !recordId) {
      const book = {
        id: String(nextBookId),
        title: String(options.body?.title || "")
      };
      nextBookId += 1;
      books.value = [...books.value, book];
      return cloneBook(book);
    }

    if (method === "PATCH" && recordId) {
      const currentBook = requireBook(recordId);
      const book = {
        ...currentBook,
        title: String(options.body?.title || currentBook.title)
      };
      books.value = books.value.map((entry) => entry.id === recordId ? book : entry);
      return cloneBook(book);
    }

    if (method === "DELETE" && recordId) {
      requireBook(recordId);
      books.value = books.value.filter((book) => book.id !== recordId);
      deleteRequestCount.value += 1;
      return { id: recordId, deleted: true };
    }

    throw new Error(`Unexpected fixture request: ${method} ${pathname}`);
  }
});

export {
  bookClient,
  bookFormFields,
  bookResource,
  deleteRequestCount
};
