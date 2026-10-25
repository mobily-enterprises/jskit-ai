import { normalizeText as normalizeAgentText } from "./normalize.js";
import { codexAppServerProjectHookTrustConfig, codexAppServerTextHasControlCharacters } from "./codexConfiguration.js";
import {
  codexAppServerRequestIsInvalid,
  CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH,
  CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT
} from "./codexProvider.js";

// Renewal thread operations: resume the exact retained thread, or prove a
// genuinely fresh successor thread for one renewal operation.
const CODEX_RENEWAL_UNMATERIALIZED_THREAD_SUFFIX =
  "is not materialized yet; includeTurns is unavailable before first user message";

export function defineCodexRenewalThreadIds(value = [], {
  errorCode = "codex_renewal_fresh_thread_required"
} = {}) {
  if (
    !Array.isArray(value) ||
    value.length > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT
  ) {
    throw codexRenewalThreadError(
      errorCode,
      "The successor assistant thread inventory is invalid."
    );
  }
  const threadIds = value.map((threadId) => normalizeAgentText(threadId));
  if (
    threadIds.some((threadId) => (
      !threadId ||
      threadId.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH ||
      codexAppServerTextHasControlCharacters(threadId)
    )) ||
    new Set(threadIds).size !== threadIds.length
  ) {
    throw codexRenewalThreadError(
      errorCode,
      "The successor assistant thread inventory contains an invalid identity."
    );
  }
  return Object.freeze([...threadIds].sort());
}

async function listCodexRenewalThreadIds(provider, workdir, errorCode) {
  if (typeof provider?.listAppServerThreadsForCwd !== "function") {
    throw codexRenewalThreadError(
      errorCode,
      "The assistant provider cannot inventory the successor's exact session threads."
    );
  }
  const normalizedWorkdir = normalizeAgentText(workdir);
  const inventory = await provider.listAppServerThreadsForCwd({
    cwd: normalizedWorkdir
  });
  if (normalizeAgentText(inventory?.cwd) !== normalizedWorkdir) {
    throw codexRenewalThreadError(
      errorCode,
      "The assistant provider returned a thread inventory for a different session source."
    );
  }
  return defineCodexRenewalThreadIds(inventory?.threadIds, { errorCode });
}

function assertCodexRenewalThreadSnapshot(threadSnapshot = null, {
  threadId = "",
  workdir = "",
  errorCode
} = {}) {
  const expectedThreadId = normalizeAgentText(threadId);
  const expectedWorkdir = normalizeAgentText(workdir);
  const actualThreadId = codexAppServerThreadResponseId(threadSnapshot);
  const actualWorkdir = normalizeAgentText(
    threadSnapshot?.cwd ||
    threadSnapshot?.raw?.cwd ||
    threadSnapshot?.response?.thread?.cwd
  );
  if (actualThreadId !== expectedThreadId || actualWorkdir !== expectedWorkdir) {
    throw codexRenewalThreadError(
      errorCode,
      "The assistant provider could not verify the exact successor thread and session source.",
      {
        actualThreadId,
        actualWorkdir,
        expectedThreadId,
        expectedWorkdir
      }
    );
  }
  return threadSnapshot;
}

function codexRenewalThreadNeedsStatusRead(error = null, threadId = "") {
  const normalizedThreadId = normalizeAgentText(threadId);
  return Boolean(
    normalizedThreadId &&
    (
      (
        codexAppServerRequestIsInvalid(error, "thread/read") &&
        normalizeAgentText(error?.message) ===
          `thread ${normalizedThreadId} ${CODEX_RENEWAL_UNMATERIALIZED_THREAD_SUFFIX}`
      ) ||
      (
        Number(error?.code) === -32601 &&
        normalizeAgentText(error?.method) === "thread/read"
      )
    )
  );
}

async function readCodexRenewalSuccessorThreadSnapshot({
  provider,
  threadId = "",
  workdir = "",
  errorCode
} = {}) {
  try {
    return assertCodexRenewalThreadSnapshot(
      await provider.readThread(threadId),
      { threadId, workdir, errorCode }
    );
  } catch (error) {
    if (
      !codexRenewalThreadNeedsStatusRead(error, threadId) ||
      typeof provider?.readThreadStatus !== "function"
    ) {
      throw error;
    }
    return assertCodexRenewalThreadSnapshot(
      await provider.readThreadStatus(threadId),
      { threadId, workdir, errorCode }
    );
  }
}

export function codexRenewalThreadError(code, message, details = {}, {
  retryable = false
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = {
    ...details,
    retryable
  };
  error.retryable = retryable;
  return error;
}

function codexAppServerThreadResponseId(thread = null, fallback = "") {
  return normalizeAgentText(
    thread?.id ||
    thread?.response?.thread?.id ||
    fallback
  );
}

/** Resume only the supplied retained thread; native read failures never replace it. */
export async function resumeExactCodexAppServerThread({
  expectedThreadId = "",
  provider,
  settings,
  projectHooks = false,
  workdir = "",
  errorCode = "codex_renewal_thread_unreadable"
} = {}) {
  const normalizedWorkdir = normalizeAgentText(workdir);
  const normalizedExpectedThreadId = normalizeAgentText(expectedThreadId);
  if (
    typeof provider?.ensureRuntime !== "function" ||
    typeof provider?.resumeThread !== "function" ||
    typeof provider?.readThread !== "function"
  ) {
    throw codexRenewalThreadError(
      errorCode,
      "The old assistant provider cannot read its exact main thread.",
      { expectedThreadId: normalizedExpectedThreadId }
    );
  }
  const appServerRuntime = await provider.ensureRuntime();
  const config = projectHooks
    ? await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir)
    : null;
  const { threadSettings } = await settings(normalizedWorkdir, config);
  let thread = null;
  let threadSnapshot = null;
  try {
    thread = await provider.resumeThread(normalizedExpectedThreadId, threadSettings);
    const resumedThreadId = codexAppServerThreadResponseId(thread, normalizedExpectedThreadId);
    if (resumedThreadId !== normalizedExpectedThreadId) {
      throw codexRenewalThreadError(
        errorCode,
        "The old assistant provider resumed a different thread.",
        {
          expectedThreadId: normalizedExpectedThreadId,
          resumedThreadId
        }
      );
    }
    threadSnapshot = await provider.readThread(normalizedExpectedThreadId);
  } catch (error) {
    if (
      error?.code === errorCode ||
      codexAppServerRequestIsInvalid(error, "thread/resume") ||
      codexAppServerRequestIsInvalid(error, "thread/read")
    ) {
      if (error?.code === errorCode) {
        throw error;
      }
      throw codexRenewalThreadError(
        errorCode,
        "The old assistant thread cannot be read. Write or edit the handover manually instead.",
        {
          expectedThreadId: normalizedExpectedThreadId,
          providerError: normalizeAgentText(error?.message)
        }
      );
    }
    throw error;
  }
  return Object.freeze({
    appServerRuntime,
    thread,
    threadId: normalizedExpectedThreadId,
    threadSnapshot,
    threadSettings
  });
}

/** Preserve the original baseline → create/adopt → durable identity → first-read order. */
export async function startFreshCodexAppServerThread({
  provider,
  settings,
  projectHooks = false,
  identity,
  resumableThreadId = "",
  forbiddenThreadId = "",
  operationId = "",
  workdir = "",
  errorCode = "codex_renewal_fresh_thread_required",
  applicationName = "The application"
} = {}) {
  const normalizedWorkdir = normalizeAgentText(workdir);
  const normalizedForbiddenThreadId = normalizeAgentText(forbiddenThreadId);
  const normalizedOperationId = normalizeAgentText(operationId);
  if (resumableThreadId && resumableThreadId === normalizedForbiddenThreadId) {
    throw codexRenewalThreadError(
      errorCode,
      "The renewed session cannot reuse the old session's assistant thread.",
      { forbiddenThreadId: normalizedForbiddenThreadId }
    );
  }
  if (
    typeof provider?.ensureRuntime !== "function" ||
    typeof provider?.resumeThread !== "function" ||
    typeof provider?.readThread !== "function" ||
    typeof provider?.startThread !== "function"
  ) {
    throw codexRenewalThreadError(
      errorCode,
      "The assistant provider cannot prove a genuinely fresh renewal thread."
    );
  }
  const appServerRuntime = await provider.ensureRuntime();
  const config = projectHooks
    ? await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir)
    : null;
  const { threadSettings, threadStartSettings } = await settings(normalizedWorkdir, config);
  let fresh = false;
  let thread = null;
  let threadSnapshot = null;
  let baselineThreadIds = Object.freeze([]);
  if (resumableThreadId) {
    try {
      thread = await provider.resumeThread(resumableThreadId, threadSettings);
      const resumedThreadId = codexAppServerThreadResponseId(thread, resumableThreadId);
      if (resumedThreadId !== resumableThreadId) {
        throw codexRenewalThreadError(
          errorCode,
          "The assistant provider resumed a different renewal thread.",
          {
            expectedThreadId: resumableThreadId,
            resumedThreadId
          }
        );
      }
      threadSnapshot = await readCodexRenewalSuccessorThreadSnapshot({
        provider,
        threadId: resumableThreadId,
        workdir: normalizedWorkdir,
        errorCode
      });
    } catch (error) {
      if (
        error?.code === errorCode ||
        codexAppServerRequestIsInvalid(error, "thread/resume") ||
        codexAppServerRequestIsInvalid(error, "thread/read")
      ) {
        if (error?.code === errorCode) {
          throw error;
        }
        throw codexRenewalThreadError(
          errorCode,
          `The previously started renewal thread is no longer readable; ${applicationName} will not replace it silently.`,
          {
            expectedThreadId: resumableThreadId,
            providerError: normalizeAgentText(error?.message)
          }
        );
      }
      throw error;
    }
  } else {
    if (!normalizedOperationId) {
      throw codexRenewalThreadError(
        errorCode,
        "Starting a fresh successor thread requires its exact renewal operation id."
      );
    }
    baselineThreadIds = await identity.readBaseline();
    if (!baselineThreadIds) {
      baselineThreadIds = await listCodexRenewalThreadIds(
        provider,
        normalizedWorkdir,
        errorCode
      );
      await identity.writeBaseline(baselineThreadIds);
    }
    const currentThreadIds = await listCodexRenewalThreadIds(
      provider,
      normalizedWorkdir,
      errorCode
    );
    const baseline = new Set(baselineThreadIds);
    const candidateThreadIds = currentThreadIds.filter((threadId) => !baseline.has(threadId));
    if (candidateThreadIds.length > 1) {
      throw codexRenewalThreadError(
        errorCode,
        `More than one unclaimed assistant thread appeared for this renewal; ${applicationName} will not guess which one is authoritative.`,
        { candidateThreadIds }
      );
    }
    if (candidateThreadIds.length === 1) {
      const [candidateThreadId] = candidateThreadIds;
      thread = await provider.resumeThread(candidateThreadId, threadSettings);
      const resumedThreadId = codexAppServerThreadResponseId(thread, candidateThreadId);
      if (resumedThreadId !== candidateThreadId) {
        throw codexRenewalThreadError(
          errorCode,
          "The assistant provider resumed a different recovered renewal thread.",
          {
            expectedThreadId: candidateThreadId,
            resumedThreadId
          }
        );
      }
      threadSnapshot = await readCodexRenewalSuccessorThreadSnapshot({
        provider,
        threadId: candidateThreadId,
        workdir: normalizedWorkdir,
        errorCode
      });
    } else {
      thread = await provider.startThread(threadStartSettings);
      fresh = true;
    }
  }
  const threadId = codexAppServerThreadResponseId(thread, resumableThreadId);
  if (
    !threadId ||
    threadId === normalizedForbiddenThreadId ||
    (fresh && baselineThreadIds.includes(threadId))
  ) {
    throw codexRenewalThreadError(
      errorCode,
      threadId
        ? "The assistant provider reused the old session's thread instead of starting a fresh one."
        : "The assistant provider did not return a fresh renewal thread id.",
      {
        forbiddenThreadId: normalizedForbiddenThreadId,
        threadId
      }
    );
  }
  await identity.write({ appServerRuntime, threadId, workdir: normalizedWorkdir });
  if (fresh) {
    try {
      threadSnapshot = await readCodexRenewalSuccessorThreadSnapshot({
        provider,
        threadId,
        workdir: normalizedWorkdir,
        errorCode
      });
    } catch (error) {
      throw codexRenewalThreadError(
        errorCode,
        `The newly started renewal thread cannot be read; ${applicationName} will not replace it silently.`,
        {
          providerError: normalizeAgentText(error?.message),
          threadId
        },
        { retryable: true }
      );
    }
  }
  return Object.freeze({
    appServerRuntime,
    fresh,
    thread,
    threadId,
    threadSnapshot,
    threadStartSettings,
    threadSettings
  });
}
