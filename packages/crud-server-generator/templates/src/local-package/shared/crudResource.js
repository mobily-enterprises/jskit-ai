import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "${option:namespace|snake}",
  tableName: __JSKIT_CRUD_TABLE_NAME__,
  schema: {
__JSKIT_CRUD_RESOURCE_SCHEMA_PROPERTIES__
  },
  searchSchema: {
__JSKIT_CRUD_RESOURCE_SEARCH_SCHEMA_LINES__
  },
  defaultSort: __JSKIT_CRUD_RESOURCE_DEFAULT_SORT__,
  autofilter: __JSKIT_CRUD_RESOURCE_AUTOFILTER__,
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
  },
  contract: {
    lookup: {
      containerKey: "lookups",
      defaultInclude: "*",
      maxDepth: 3
    }
  }
});

export { resource };
