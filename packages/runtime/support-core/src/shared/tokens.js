const TOKENS = Object.freeze({
  Logger: Symbol.for("jskit.logger"),
  Env: Symbol.for("jskit.env"),
  Fastify: Symbol.for("jskit.fastify"),
  HttpRouter: Symbol.for("jskit.http.router"),
  CommandRegistry: Symbol.for("jskit.console.commands"),
  ConsoleKernel: Symbol.for("jskit.console.kernel"),
  QueueRegistry: Symbol.for("jskit.queue.jobs"),
  WorkerKernel: Symbol.for("jskit.queue.workerKernel"),
  Knex: Symbol.for("jskit.database.knex"),
  TransactionManager: Symbol.for("jskit.database.transactionManager"),
  HealthService: Symbol.for("jskit.health.service")
});

export { TOKENS };
