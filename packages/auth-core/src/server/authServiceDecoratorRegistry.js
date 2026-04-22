import { registerTaggedSingleton, resolveTaggedEntries } from "@jskit-ai/kernel/server/registries";

const AUTH_SERVICE_DECORATOR_TAG = "jskit.auth.service.decorators";

function normalizeAuthServiceDecorator(entry) {
  if (typeof entry === "function") {
    return Object.freeze({
      decoratorId: String(entry.name || "anonymous"),
      order: 0,
      decorateAuthService: entry
    });
  }

  if (!entry || typeof entry !== "object" || typeof entry.decorateAuthService !== "function") {
    return null;
  }

  const decoratorId = String(entry.decoratorId || "anonymous");
  const order = Number.isFinite(entry.order) ? Number(entry.order) : 0;

  return Object.freeze({
    ...entry,
    decoratorId,
    order,
    decorateAuthService: entry.decorateAuthService
  });
}

function registerAuthServiceDecorator(app, token, factory) {
  registerTaggedSingleton(app, token, factory, AUTH_SERVICE_DECORATOR_TAG, {
    context: "registerAuthServiceDecorator"
  });
}

function resolveAuthServiceDecorators(scope) {
  return resolveTaggedEntries(scope, AUTH_SERVICE_DECORATOR_TAG)
    .map((entry, index) => ({
      decorator: normalizeAuthServiceDecorator(entry),
      index
    }))
    .filter((entry) => Boolean(entry.decorator))
    .sort((left, right) => {
      if (left.decorator.order !== right.decorator.order) {
        return left.decorator.order - right.decorator.order;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.decorator);
}

export {
  AUTH_SERVICE_DECORATOR_TAG,
  registerAuthServiceDecorator,
  resolveAuthServiceDecorators
};
