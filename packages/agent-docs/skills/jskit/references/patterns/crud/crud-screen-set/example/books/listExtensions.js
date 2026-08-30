import { defineCrudListBulkActions } from "@jskit-ai/http-web/client/bulkActions";
import { defineCrudListFilters } from "@jskit-ai/http-web/client/filters";
import { defineCrudListRowActions } from "@jskit-ai/http-web/client/rowActions";

const listFilters = defineCrudListFilters({});
const listBulkActions = defineCrudListBulkActions([]);
const listRowActions = defineCrudListRowActions([]);

export { listBulkActions, listFilters, listRowActions };
