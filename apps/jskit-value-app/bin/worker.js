#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlatformRuntimeEnv } from "@jskit-ai/runtime-env-core/platformRuntimeEnv";
import { repositoryConfig } from "../config/index.js";
import { buildRetentionPolicyFromRepositoryConfig } from "@jskit-ai/retention-core";
import { createWorkerRuntime } from "../server/workers/runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RBAC_MANIFEST_PATH = "./shared/rbac.manifest.json";
const runtimeEnv = createPlatformRuntimeEnv({
  rootDir: path.resolve(__dirname, ".."),
  defaults: {
    RBAC_MANIFEST_PATH: DEFAULT_RBAC_MANIFEST_PATH
  }
});
const retentionPolicy = buildRetentionPolicyFromRepositoryConfig({
  repositoryConfig,
  batchSize: runtimeEnv.RETENTION_BATCH_SIZE
});

const runtime = createWorkerRuntime({
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
    console.log(`Received ${signal}. Stopping worker runtime.`);
  }

  try {
    await runtime.stop();
    process.exit(exitCode);
  } catch (error) {
    console.error("Failed to stop worker runtime cleanly:", error);
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
  console.log(`Worker runtime started for queue "${started.queue}" with concurrency ${started.concurrency}.`);
} catch (error) {
  console.error("Failed to initialize worker runtime:", error);
  process.exit(1);
}
