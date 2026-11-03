// One native OpenCode session: its model, its selection, the shared server
// bound to its directory, and the start that creates or resumes it.
import { normalizeNullableText } from "./normalize.js";

const text = normalizeNullableText;

/** The shared server with its client bound to one native directory. */
export function openCodeServerForDirectory(server, workdir) {
  return Object.freeze({
    ...server,
    client: server.client.forDirectory(workdir)
  });
}

/** The native model a selection names, or the one an execution profile overrides it with. */
export function openCodeModel(selection = {}, executionProfile = null) {
  const modelId = text(executionProfile?.model) || text(selection.modelId);
  const variantId = executionProfile
    ? text(executionProfile.thinking)
    : text(selection.variantId);
  return {
    id: modelId,
    providerID: text(selection.modelProviderId),
    ...(variantId ? { variant: variantId } : {})
  };
}

/** Whether two selections name the same agent, model, provider and variant. */
export function sameOpenCodeSelection(left, right) {
  return ["agentId", "modelId", "modelProviderId", "variantId"]
    .every((name) => text(left?.[name]) === text(right?.[name]));
}

/**
 * Native selection and identity publication share the same pending operation.
 * @param {object} target
 * @param {{ selection: object, model: object, workdir?: string, signal?: AbortSignal, invalidIdentity?: () => Error,
 *   identity: { write(nativeId: string): unknown, publish(nativeId: string): unknown } }} session
 */
export async function ensureOpenCodeSession(target, { selection, model, workdir = target.workdir, identity, signal,
  invalidIdentity = () => new Error("OpenCode did not return a native conversation ID.") }) {
  if (target.upstreamStart) {
    return target.upstreamStart;
  }
  const start = Promise.resolve().then(async () => {
    await target.server.client.prepareDirectory({ signal });
    let upstream = (
      target.upstream &&
      sameOpenCodeSelection(target.upstreamSelection, selection)
    ) ? target.upstream : null;
    if (!upstream && target.upstreamSessionId) {
      upstream = await target.server.client.readSession(target.upstreamSessionId, { signal });
      await target.server.client.switchModel(target.upstreamSessionId, model, { signal });
      await target.server.client.switchAgent(target.upstreamSessionId, selection.agentId, { signal });
    } else if (!upstream) {
      upstream = await target.server.client.createSession({
        agent: selection.agentId,
        location: { directory: workdir },
        model
      }, { signal });
    }
    const nativeId = text(upstream?.id);
    if (!nativeId) {
      throw invalidIdentity();
    }
    await identity.write(nativeId);
    target.upstreamSessionId = nativeId;
    target.upstream = upstream;
    target.upstreamSelection = { ...selection };
    await identity.publish(nativeId);
    return target;
  });
  target.upstreamStart = start;
  try {
    return await start;
  } finally {
    if (target.upstreamStart === start) {
      delete target.upstreamStart;
    }
  }
}
