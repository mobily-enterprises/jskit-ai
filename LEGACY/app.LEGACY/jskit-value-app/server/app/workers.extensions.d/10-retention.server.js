export default Object.freeze({
  id: "retention-worker-extension",
  order: 10,
  workerRuntime: {
    concurrency: null,
    lockHeldRequeueMax: null,
    retentionLockTtlMs: null
  },
  queues: [],
  processors: []
});
