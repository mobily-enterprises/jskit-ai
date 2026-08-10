import { UsersWebClientProvider } from "./providers/UsersWebClientProvider.js";

export { UsersWebClientProvider } from "./providers/UsersWebClientProvider.js";
export { default as AccountSettingsClientElement } from "./components/AccountSettingsClientElement.vue";
export { default as CrudAddEditScreen } from "./components/CrudAddEditScreen.vue";
export { default as CrudListBulkActionSurface } from "./components/CrudListBulkActionSurface.vue";
export { default as CrudListFilterSurface } from "./components/CrudListFilterSurface.vue";
export { default as CrudListScreen } from "./components/CrudListScreen.vue";
export { default as CrudViewScreen } from "./components/CrudViewScreen.vue";
export {
  normalizeCrudApiAccess,
  resolveCrudHttpClient
} from "./composables/crud/crudHttpClientSupport.js";

const clientProviders = Object.freeze([UsersWebClientProvider]);

export { clientProviders };
