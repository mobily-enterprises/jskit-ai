import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { createVuetify } from "vuetify";
import * as vuetifyComponents from "vuetify/components";
import * as vuetifyDirectives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import "vuetify/styles";
import { configureUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";
import App from "./App.vue";
import BookEditPage from "./BookEditPage.vue";
import BookListPage from "./BookListPage.vue";
import BookNewPage from "./BookNewPage.vue";
import BookViewPage from "./BookViewPage.vue";
import { bookClient } from "./bookFixture.js";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/books" },
    { path: "/books", name: "books-list", component: BookListPage },
    { path: "/books/new", name: "books-new", component: BookNewPage },
    { path: "/books/:bookId/edit", name: "books-edit", component: BookEditPage },
    { path: "/books/:bookId", name: "books-view", component: BookViewPage }
  ]
});
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false }
  }
});
const vuetify = createVuetify({
  components: vuetifyComponents,
  directives: vuetifyDirectives,
  icons: {
    defaultSet: "mdi",
    aliases,
    sets: { mdi }
  }
});

configureUsersWebHttpClient(bookClient);

const app = createApp(App);
app.use(router);
app.use(VueQueryPlugin, { queryClient });
app.use(vuetify);
await router.isReady();
app.mount("#app");
