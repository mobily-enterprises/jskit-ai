import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_RUNTIME_MODULES = Object.freeze({
  frameworkDependencyCheckModulePath: "server/framework/dependencyCheck.js",
  frameworkExtensionsValidationModulePath: "server/framework/extensionsValidation.js",
  repositoryConfigModulePath: "config/index.js",
  workerRuntimeModulePath: "server/workers/runtime.js",
  workerQueueModulePath: "server/workers/index.js",
  workerEnqueueCliModulePath: "server/workers/enqueueRetentionSweepCli.js",
  runtimeRepositoryDefinitionsModulePath: "server/runtime/repositories.js",
  dbModulePath: "db/knex.js"
});

const RUNTIME_BUILTIN_IDS = Object.freeze(
  new Set([
    "framework:deps:check",
    "framework:extensions:validate",
    "runtime:worker",
    "runtime:worker:retention:enqueue",
    "runtime:worker:retention:enqueue:dry-run",
    "runtime:ops:retention",
    "runtime:ops:retention:dry-run"
  ])
);

function normalizeRuntimeModulePath(value, fallback) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function resolveRuntimeModulesConfig(config) {
  const source = config?.runtime && typeof config.runtime === "object" && !Array.isArray(config.runtime) ? config.runtime : {};
  return {
    frameworkDependencyCheckModulePath: normalizeRuntimeModulePath(
      source.frameworkDependencyCheckModulePath,
      DEFAULT_RUNTIME_MODULES.frameworkDependencyCheckModulePath
    ),
    frameworkExtensionsValidationModulePath: normalizeRuntimeModulePath(
      source.frameworkExtensionsValidationModulePath,
      DEFAULT_RUNTIME_MODULES.frameworkExtensionsValidationModulePath
    ),
    repositoryConfigModulePath: normalizeRuntimeModulePath(
      source.repositoryConfigModulePath,
      DEFAULT_RUNTIME_MODULES.repositoryConfigModulePath
    ),
    workerRuntimeModulePath: normalizeRuntimeModulePath(
      source.workerRuntimeModulePath,
      DEFAULT_RUNTIME_MODULES.workerRuntimeModulePath
    ),
    workerQueueModulePath: normalizeRuntimeModulePath(
      source.workerQueueModulePath,
      DEFAULT_RUNTIME_MODULES.workerQueueModulePath
    ),
    workerEnqueueCliModulePath: normalizeRuntimeModulePath(
      source.workerEnqueueCliModulePath,
      DEFAULT_RUNTIME_MODULES.workerEnqueueCliModulePath
    ),
    runtimeRepositoryDefinitionsModulePath: normalizeRuntimeModulePath(
      source.runtimeRepositoryDefinitionsModulePath,
      DEFAULT_RUNTIME_MODULES.runtimeRepositoryDefinitionsModulePath
    ),
    dbModulePath: normalizeRuntimeModulePath(source.dbModulePath, DEFAULT_RUNTIME_MODULES.dbModulePath)
  };
}

async function importModuleFromApp(appRoot, relativePath) {
  const resolvedPath = path.resolve(appRoot, relativePath);
  return import(pathToFileURL(resolvedPath).href);
}

function parseFrameworkCliArgs(argv, { includeExtensionModules = false } = {}) {
  const output = {
    mode: undefined,
    enabledModuleIds: undefined,
    profileId: undefined,
    optionalModulePacks: undefined,
    extensionModulePaths: [],
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = String(argv[index] || "").trim();
    if (!rawArg) {
      continue;
    }

    if (rawArg === "--json") {
      output.json = true;
      continue;
    }

    if (rawArg === "--mode" || rawArg.startsWith("--mode=")) {
      const mode = rawArg === "--mode" ? String(argv[index + 1] || "").trim() : String(rawArg.split("=")[1] || "").trim();
      if (!mode) {
        throw new Error("Missing value for --mode.");
      }
      output.mode = mode;
      if (rawArg === "--mode") {
        index += 1;
      }
      continue;
    }

    if (rawArg === "--enabled" || rawArg.startsWith("--enabled=")) {
      const value =
        rawArg === "--enabled" ? String(argv[index + 1] || "").trim() : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --enabled.");
      }
      output.enabledModuleIds = value;
      if (rawArg === "--enabled") {
        index += 1;
      }
      continue;
    }

    if (rawArg === "--profile" || rawArg.startsWith("--profile=")) {
      const value =
        rawArg === "--profile" ? String(argv[index + 1] || "").trim() : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --profile.");
      }
      output.profileId = value;
      if (rawArg === "--profile") {
        index += 1;
      }
      continue;
    }

    if (rawArg === "--packs" || rawArg.startsWith("--packs=")) {
      const value =
        rawArg === "--packs" ? String(argv[index + 1] || "").trim() : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --packs.");
      }
      output.optionalModulePacks = value;
      if (rawArg === "--packs") {
        index += 1;
      }
      continue;
    }

    if (includeExtensionModules && (rawArg === "--module" || rawArg.startsWith("--module="))) {
      const value =
        rawArg === "--module" ? String(argv[index + 1] || "").trim() : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --module.");
      }
      output.extensionModulePaths.push(value);
      if (rawArg === "--module") {
        index += 1;
      }
      continue;
    }

    if (includeExtensionModules && (rawArg === "--modules" || rawArg.startsWith("--modules="))) {
      const value =
        rawArg === "--modules" ? String(argv[index + 1] || "").trim() : String(rawArg.split("=")[1] || "").trim();
      if (!value) {
        throw new Error("Missing value for --modules.");
      }
      output.extensionModulePaths.push(value);
      if (rawArg === "--modules") {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unsupported argument "${rawArg}".`);
  }

  return output;
}

function parseRetentionSweepArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run")
  };
}

async function createRuntimeEnvForApp(appRoot) {
  const { createPlatformRuntimeEnv } = await import("@jskit-ai/runtime-env-core/platformRuntimeEnv");
  return createPlatformRuntimeEnv({
    rootDir: appRoot,
    defaults: {
      RBAC_MANIFEST_PATH: "./shared/rbac.manifest.json"
    }
  });
}

async function runFrameworkDependencyCheck({ appRoot, modulesConfig, extraArgs }) {
  const args = parseFrameworkCliArgs(extraArgs, { includeExtensionModules: false });
  const dependencyCheckModule = await importModuleFromApp(appRoot, modulesConfig.frameworkDependencyCheckModulePath);
  const { resolveFrameworkDependencyCheck, formatFrameworkDependencyCheckResult, formatFrameworkDependencyCheckFailure } =
    dependencyCheckModule;

  try {
    const result = resolveFrameworkDependencyCheck({
      mode: args.mode,
      enabledModuleIds: args.enabledModuleIds,
      profileId: args.profileId,
      optionalModulePacks: args.optionalModulePacks
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write(formatFrameworkDependencyCheckResult(result));
  } catch (error) {
    process.stderr.write(formatFrameworkDependencyCheckFailure(error));
    process.exitCode = 1;
  }
}

async function runFrameworkExtensionsValidation({ appRoot, modulesConfig, extraArgs }) {
  const args = parseFrameworkCliArgs(extraArgs, { includeExtensionModules: true });
  const extensionsValidationModule = await importModuleFromApp(
    appRoot,
    modulesConfig.frameworkExtensionsValidationModulePath
  );
  const {
    resolveFrameworkExtensionsValidation,
    formatFrameworkExtensionsValidationResult,
    formatFrameworkExtensionsValidationFailure
  } = extensionsValidationModule;

  try {
    const result = await resolveFrameworkExtensionsValidation({
      mode: args.mode,
      enabledModuleIds: args.enabledModuleIds,
      profileId: args.profileId,
      optionalModulePacks: args.optionalModulePacks,
      extensionModulePaths: args.extensionModulePaths,
      cwd: process.cwd()
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    process.stdout.write(formatFrameworkExtensionsValidationResult(result));
  } catch (error) {
    process.stderr.write(formatFrameworkExtensionsValidationFailure(error));
    process.exitCode = 1;
  }
}

async function runWorkerRuntime({ appRoot, modulesConfig }) {
  const runtimeEnv = await createRuntimeEnvForApp(appRoot);
  const { buildRetentionPolicyFromRepositoryConfig } = await import("@jskit-ai/retention-core");
  const configModule = await importModuleFromApp(appRoot, modulesConfig.repositoryConfigModulePath);
  const workerRuntimeModule = await importModuleFromApp(appRoot, modulesConfig.workerRuntimeModulePath);

  const retentionPolicy = buildRetentionPolicyFromRepositoryConfig({
    repositoryConfig: configModule.repositoryConfig,
    batchSize: runtimeEnv.RETENTION_BATCH_SIZE
  });

  const runtime = workerRuntimeModule.createWorkerRuntime({
    redisUrl: runtimeEnv.REDIS_URL,
    redisNamespace: runtimeEnv.REDIS_NAMESPACE,
    workerConcurrency: runtimeEnv.WORKER_CONCURRENCY,
    lockHeldRequeueMax: runtimeEnv.WORKER_LOCK_HELD_REQUEUE_MAX,
    retentionLockTtlMs: runtimeEnv.WORKER_RETENTION_LOCK_TTL_MS,
    retentionConfig: retentionPolicy,
    logger: console
  });

  let shuttingDown = false;
  async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (signal) {
      process.stdout.write(`Received ${signal}. Stopping worker runtime.\n`);
    }
    try {
      await runtime.stop();
      process.exit(exitCode);
    } catch (error) {
      process.stderr.write(`Failed to stop worker runtime cleanly: ${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    }
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT", 0);
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM", 0);
  });

  try {
    const started = await runtime.start();
    process.stdout.write(
      `Worker runtime started for queue "${started.queue}" with concurrency ${started.concurrency}.\n`
    );
  } catch (error) {
    process.stderr.write(`Failed to initialize worker runtime: ${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  }
}

async function runRetentionEnqueue({ appRoot, modulesConfig, extraArgs }) {
  const runtimeEnv = await createRuntimeEnvForApp(appRoot);
  const workersIndexModule = await importModuleFromApp(appRoot, modulesConfig.workerQueueModulePath);
  const enqueueCliModule = await importModuleFromApp(appRoot, modulesConfig.workerEnqueueCliModulePath);
  const { RETENTION_QUEUE_NAME, createRetentionQueue, createWorkerRedisConnection, enqueueRetentionSweep, closeWorkerRedisConnection } =
    workersIndexModule;
  const { parseCliArgs, buildEnqueueOutput } = enqueueCliModule;

  const parsed = parseCliArgs(extraArgs);
  const connection = createWorkerRedisConnection({
    redisUrl: runtimeEnv.REDIS_URL
  });
  const queue = createRetentionQueue({
    connection,
    redisNamespace: runtimeEnv.REDIS_NAMESPACE
  });

  try {
    const job = await enqueueRetentionSweep({
      queue,
      payload: {
        dryRun: parsed.dryRun,
        trigger: parsed.trigger,
        requestedBy: parsed.requestedBy,
        idempotencyKey: parsed.idempotencyKey
      }
    });

    process.stdout.write(
      `${JSON.stringify(
        buildEnqueueOutput({
          queueName: RETENTION_QUEUE_NAME,
          job,
          dryRun: parsed.dryRun
        }),
        null,
        2
      )}\n`
    );
  } finally {
    if (typeof queue.close === "function") {
      await queue.close();
    }
    await closeWorkerRedisConnection(connection);
  }
}

async function runRetentionSweep({ appRoot, modulesConfig, extraArgs }) {
  const runtimeEnv = await createRuntimeEnvForApp(appRoot);
  const { createRepositoryRegistry } = await import("@jskit-ai/server-runtime-core/composition");
  const { createService: createRetentionService, buildRetentionPolicyFromRepositoryConfig } = await import(
    "@jskit-ai/retention-core"
  );
  const configModule = await importModuleFromApp(appRoot, modulesConfig.repositoryConfigModulePath);
  const dbModule = await importModuleFromApp(appRoot, modulesConfig.dbModulePath);
  const repositoriesModule = await importModuleFromApp(appRoot, modulesConfig.runtimeRepositoryDefinitionsModulePath);

  const args = parseRetentionSweepArgs(extraArgs);
  const repositories = createRepositoryRegistry(repositoriesModule.PLATFORM_REPOSITORY_DEFINITIONS);
  const retentionPolicy = buildRetentionPolicyFromRepositoryConfig({
    repositoryConfig: configModule.repositoryConfig,
    batchSize: runtimeEnv.RETENTION_BATCH_SIZE
  });

  const retentionService = createRetentionService({
    consoleErrorLogsRepository: repositories.consoleErrorLogsRepository,
    workspaceInvitesRepository: repositories.workspaceInvitesRepository,
    consoleInvitesRepository: repositories.consoleInvitesRepository,
    auditEventsRepository: repositories.auditEventsRepository,
    aiTranscriptConversationsRepository: repositories.aiTranscriptConversationsRepository,
    aiTranscriptMessagesRepository: repositories.aiTranscriptMessagesRepository,
    chatThreadsRepository: repositories.chatThreadsRepository,
    chatParticipantsRepository: repositories.chatParticipantsRepository,
    chatMessagesRepository: repositories.chatMessagesRepository,
    chatIdempotencyTombstonesRepository: repositories.chatIdempotencyTombstonesRepository,
    chatAttachmentsRepository: repositories.chatAttachmentsRepository,
    billingRepository: repositories.billingRepository,
    retentionConfig: retentionPolicy
  });

  try {
    const summary = await retentionService.runSweep({
      dryRun: args.dryRun,
      logger: console
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await dbModule.closeDatabase();
  }
}

async function runRuntimeBuiltinTask({ builtinTaskId, appRoot, config, extraArgs }) {
  const modulesConfig = resolveRuntimeModulesConfig(config);

  if (builtinTaskId === "framework:deps:check") {
    await runFrameworkDependencyCheck({ appRoot, modulesConfig, extraArgs });
    return;
  }

  if (builtinTaskId === "framework:extensions:validate") {
    await runFrameworkExtensionsValidation({ appRoot, modulesConfig, extraArgs });
    return;
  }

  if (builtinTaskId === "runtime:worker") {
    await runWorkerRuntime({ appRoot, modulesConfig });
    return;
  }

  if (builtinTaskId === "runtime:worker:retention:enqueue") {
    await runRetentionEnqueue({ appRoot, modulesConfig, extraArgs });
    return;
  }

  if (builtinTaskId === "runtime:worker:retention:enqueue:dry-run") {
    await runRetentionEnqueue({
      appRoot,
      modulesConfig,
      extraArgs: extraArgs.includes("--dry-run") ? extraArgs : ["--dry-run", ...extraArgs]
    });
    return;
  }

  if (builtinTaskId === "runtime:ops:retention") {
    await runRetentionSweep({ appRoot, modulesConfig, extraArgs });
    return;
  }

  if (builtinTaskId === "runtime:ops:retention:dry-run") {
    await runRetentionSweep({
      appRoot,
      modulesConfig,
      extraArgs: extraArgs.includes("--dry-run") ? extraArgs : ["--dry-run", ...extraArgs]
    });
    return;
  }

  throw new Error(`Unknown runtime builtin task "${builtinTaskId}".`);
}

export { RUNTIME_BUILTIN_IDS, runRuntimeBuiltinTask };
