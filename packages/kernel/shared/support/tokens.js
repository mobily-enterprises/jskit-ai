const KERNEL_TOKENS = Object.freeze({
  Logger: Symbol.for("jskit.logger"),
  Env: Symbol.for("jskit.env"),
  Fastify: Symbol.for("jskit.fastify"),
  HttpRouter: Symbol.for("jskit.http.router"),
  Request: Symbol.for("jskit.http.request"),
  Reply: Symbol.for("jskit.http.reply"),
  RequestId: Symbol.for("jskit.http.requestId"),
  RequestScope: Symbol.for("jskit.http.requestScope"),
  Knex: Symbol.for("jskit.database.knex"),
  TransactionManager: Symbol.for("jskit.database.transactionManager"),
  Storage: Symbol.for("jskit.storage"),
  SurfaceRuntime: Symbol.for("jskit.surface.runtime")
});

function isContainerToken(value) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof value === "symbol" || typeof value === "function";
}

export { KERNEL_TOKENS, isContainerToken };
