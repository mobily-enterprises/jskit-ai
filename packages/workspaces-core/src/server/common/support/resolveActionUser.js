import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

function resolveActionUser(context, input) {
  const payload = normalizeObject(input);
  const request = context?.requestMeta?.request || null;
  return payload.user || request?.user || context?.actor || null;
}

export { resolveActionUser };
