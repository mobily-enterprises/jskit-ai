import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";

function serializeNullableDateTime(value) {
  if (value == null) {
    return null;
  }

  return toDatabaseDateTimeUtc(value);
}

const jsonRestResource = Object.freeze({
  tableName: __JSKIT_CRUD_TABLE_NAME__,
  searchSchema: {
__JSKIT_CRUD_JSONREST_SEARCH_SCHEMA_LINES__
  },
__JSKIT_CRUD_JSONREST_DEFAULT_SORT_LINE__
  autofilter: __JSKIT_CRUD_JSONREST_AUTOFILTER__,
  schema: {
__JSKIT_CRUD_JSONREST_SCHEMA_PROPERTIES__
  }
});

export { jsonRestResource };
