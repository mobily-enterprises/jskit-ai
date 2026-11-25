// json-rest-api's AnyAPI storage, for tables an application defines while it runs, which no table resource describes.
// These are the json-rest-api copy's own objects that the runtime's handles run on, never wrappers: json-rest-api knows
// the transactions api.transaction opened by identity, and AnyAPI its registry with instanceof, so an application's
// own AnyAPI instances join a handle's transaction only on this copy, and the application declares no json-rest-api.
export {
  AnyapiRegistry,
  JsonRestApi,
  RestApiAnyapiKnexPlugin,
  RestApiPlugin,
  RowPolicyPlugin,
  ensureAnyApiSchema
} from "json-rest-api";
