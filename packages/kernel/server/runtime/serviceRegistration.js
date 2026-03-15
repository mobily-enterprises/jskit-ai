import { normalizeObject, normalizeText } from "../../shared/support/normalize.js";
import { createEntityChangePublisher } from "./entityChangeEvents.js";
import { createAuthorizedService, getServicePermissions } from "./serviceAuthorization.js";

const SERVICE_REGISTRATION_TAG = Symbol.for("jskit.runtime.services.registrations");
const ENTITY_CHANGED_EVENT_TYPE = "entity.changed";
const DEFAULT_REALTIME_AUDIENCE = "all_workspace_users";
const REALTIME_AUDIENCE_PRESETS = new Set([
  "none",
  "all_clients",
  "all_users",
  "all_workspace_users",
  "actor_user",
  "event_scope"
]);
let SERVICE_REGISTRATION_INDEX = 0;

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeArray(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const list = [];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) {
      queue.push(...entry);
      continue;
    }
    if (entry == null) {
      continue;
    }
    list.push(entry);
  }
  return list;
}

function isContainerToken(value) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof value === "symbol" || typeof value === "function";
}

function normalizeMethodName(value, { context = "service method" } = {}) {
  const methodName = String(value || "").trim();
  if (!methodName) {
    throw new TypeError(`${context} must be a non-empty string.`);
  }
  return methodName;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }
  return parsed;
}

function createServiceRegistrationToken() {
  SERVICE_REGISTRATION_INDEX += 1;
  return Symbol(`jskit.runtime.services.registration.${SERVICE_REGISTRATION_INDEX}`);
}

function normalizeServiceEventType(value, { context = "service event" } = {}) {
  const normalizedType = normalizeText(value).toLowerCase();
  if (normalizedType !== ENTITY_CHANGED_EVENT_TYPE) {
    throw new TypeError(`${context}.type must be "${ENTITY_CHANGED_EVENT_TYPE}".`);
  }
  return normalizedType;
}

function normalizeServiceEventOperation(value, { context = "service event" } = {}) {
  if (typeof value === "function") {
    return value;
  }

  const normalizedOperation = normalizeText(value).toLowerCase();
  if (!normalizedOperation) {
    throw new TypeError(`${context}.operation is required.`);
  }
  if (normalizedOperation !== "created" && normalizedOperation !== "updated" && normalizedOperation !== "deleted") {
    throw new TypeError(`${context}.operation must be one of: created, updated, deleted.`);
  }
  return normalizedOperation;
}

function normalizeServiceEventEntityId(value) {
  if (typeof value === "function" || typeof value === "string") {
    return value;
  }

  const parsed = toPositiveInteger(value);
  if (parsed > 0) {
    return parsed;
  }

  return null;
}

function normalizeRealtimeDispatch(value, { context = "service event.realtime" } = {}) {
  const source = normalizePlainObject(value);
  if (Object.keys(source).length < 1) {
    return null;
  }

  const event = normalizeText(source.event);
  if (!event) {
    throw new TypeError(`${context}.event is required.`);
  }

  const payload = typeof source.payload === "function" ? source.payload : null;
  const audience = normalizeRealtimeAudience(source.audience, {
    context: `${context}.audience`
  });

  return Object.freeze({
    event,
    payload,
    audience
  });
}

function normalizeRealtimeAudience(value, { context = "service event.realtime.audience" } = {}) {
  if (typeof value === "undefined") {
    return DEFAULT_REALTIME_AUDIENCE;
  }

  if (typeof value === "function") {
    return value;
  }

  if (typeof value === "string") {
    const preset = normalizeText(value).toLowerCase();
    if (!REALTIME_AUDIENCE_PRESETS.has(preset)) {
      throw new TypeError(
        `${context} must be one of: ${[...REALTIME_AUDIENCE_PRESETS].join(", ")}, or a function/object.`
      );
    }
    return preset;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.freeze({
      ...value
    });
  }

  throw new TypeError(`${context} must be a string, function, or object.`);
}

function normalizeServiceEventSpec(entry, { context = "service event" } = {}) {
  const source = normalizePlainObject(entry);

  return Object.freeze({
    type: normalizeServiceEventType(source.type, { context }),
    source: normalizeText(source.source),
    entity: normalizeText(source.entity),
    operation: normalizeServiceEventOperation(source.operation, { context }),
    entityId: normalizeServiceEventEntityId(source.entityId),
    realtime: normalizeRealtimeDispatch(source.realtime, { context: `${context}.realtime` })
  });
}

function normalizeServiceMetadata(value = {}) {
  const source = normalizePlainObject(value);
  const permissions = normalizePlainObject(source.permissions);
  const eventsSource = normalizePlainObject(source.events);
  const events = {};

  for (const [methodName, eventEntries] of Object.entries(eventsSource)) {
    const normalizedMethodName = normalizeMethodName(methodName, {
      context: "service metadata.events method"
    });
    const normalizedEventEntries = normalizeArray(eventEntries).map((entry, index) =>
      normalizeServiceEventSpec(entry, {
        context: `service metadata.events.${normalizedMethodName}[${index}]`
      })
    );
    events[normalizedMethodName] = Object.freeze(normalizedEventEntries);
  }

  return Object.freeze({
    permissions: Object.freeze({ ...permissions }),
    events: Object.freeze(events)
  });
}

function normalizeServicePermissionsForDefinition(serviceDefinition, serviceMetadata) {
  const service = normalizePlainObject(serviceDefinition);
  const declaredPermissions = normalizePlainObject(serviceMetadata.permissions);
  const inheritedPermissions = getServicePermissions(service);
  const methodNames = Object.entries(service)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name);
  const methodNameSet = new Set(methodNames);
  const normalizedPermissions = {};

  for (const methodName of methodNames) {
    if (Object.hasOwn(declaredPermissions, methodName)) {
      normalizedPermissions[methodName] = normalizeObject(declaredPermissions[methodName]);
      continue;
    }

    if (Object.hasOwn(inheritedPermissions, methodName)) {
      normalizedPermissions[methodName] = normalizeObject(inheritedPermissions[methodName]);
      continue;
    }

    normalizedPermissions[methodName] = Object.freeze({
      require: "none"
    });
  }

  for (const key of Object.keys(declaredPermissions)) {
    if (!methodNameSet.has(key)) {
      throw new TypeError(`service metadata.permissions.${key} does not match a service method.`);
    }
  }

  return Object.freeze(normalizedPermissions);
}

function normalizeServiceEventsForDefinition(serviceDefinition, serviceMetadata) {
  const service = normalizePlainObject(serviceDefinition);
  const methodNameSet = new Set(
    Object.entries(service)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
  );
  const declaredEvents = normalizePlainObject(serviceMetadata.events);
  const normalizedEvents = {};

  for (const [methodName, events] of Object.entries(declaredEvents)) {
    if (!methodNameSet.has(methodName)) {
      throw new TypeError(`service metadata.events.${methodName} does not match a service method.`);
    }

    const normalizedEntries = normalizeArray(events).map((entry, index) =>
      normalizeServiceEventSpec(entry, {
        context: `service metadata.events.${methodName}[${index}]`
      })
    );

    for (const [index, entry] of normalizedEntries.entries()) {
      if (!entry.source || !entry.entity) {
        throw new TypeError(
          `service metadata.events.${methodName}[${index}] requires source and entity for "${ENTITY_CHANGED_EVENT_TYPE}".`
        );
      }
    }

    normalizedEvents[methodName] = Object.freeze(normalizedEntries);
  }

  return Object.freeze(normalizedEvents);
}

function resolveMethodOptions(args = []) {
  if (!Array.isArray(args) || args.length < 1) {
    return {};
  }

  const candidate = args[args.length - 1];
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate;
  }

  return {};
}

function resolveEventOperation(spec, state) {
  if (typeof spec.operation === "function") {
    return spec.operation({
      result: state.result,
      args: state.args,
      options: state.options,
      methodName: state.methodName,
      serviceToken: state.serviceToken
    });
  }
  return spec.operation;
}

function resolveEventEntityId(spec, state) {
  if (typeof spec.entityId === "function") {
    return spec.entityId({
      result: state.result,
      args: state.args,
      options: state.options,
      methodName: state.methodName,
      serviceToken: state.serviceToken
    });
  }

  if (typeof spec.entityId === "string") {
    return state?.result?.[spec.entityId];
  }

  if (Number.isInteger(spec.entityId) && spec.entityId > 0) {
    return spec.entityId;
  }

  return state?.result?.id;
}

function resolveEventMeta(spec, state) {
  const meta = {
    service: Object.freeze({
      token: state.serviceToken,
      method: state.methodName
    })
  };

  if (spec.realtime) {
    meta.realtime = spec.realtime.payload
      ? Object.freeze({
          event: spec.realtime.event,
          payload: spec.realtime.payload({
            event: state.event,
            result: state.result,
            args: state.args,
            options: state.options,
            methodName: state.methodName,
            serviceToken: state.serviceToken
          })
        })
      : Object.freeze({
          event: spec.realtime.event
        });
  }

  return Object.freeze(meta);
}

function createServiceMethodEventPublisher(scope, serviceToken, methodName, specs = []) {
  if (!scope || typeof scope.make !== "function" || typeof scope.has !== "function") {
    throw new TypeError("service event publisher requires a scope with has()/make().");
  }
  if (specs.length < 1) {
    return async function publishNoop() {
      return null;
    };
  }
  if (!scope.has("domainEvents")) {
    throw new Error(`app.service(${String(serviceToken)}) requires "domainEvents" binding to emit service events.`);
  }

  const domainEvents = scope.make("domainEvents");
  const publishers = specs.map((spec) =>
    createEntityChangePublisher({
      domainEvents,
      source: spec.source,
      entity: spec.entity
    })
  );

  return async function publishServiceMethodEvents(state) {
    for (const [index, spec] of specs.entries()) {
      const publisher = publishers[index];
      const operation = resolveEventOperation(spec, state);
      const entityId = resolveEventEntityId(spec, state);
      const eventMeta = resolveEventMeta(spec, {
        ...state,
        event: spec
      });
      await publisher(operation, entityId, state.options, eventMeta);
    }
    return null;
  };
}

function materializeServiceRegistration(scope, registrationSpec) {
  const service = registrationSpec.factory(scope);
  const normalizedService = normalizePlainObject(service);
  const permissions = normalizeServicePermissionsForDefinition(normalizedService, registrationSpec.metadata);
  const events = normalizeServiceEventsForDefinition(normalizedService, registrationSpec.metadata);
  const authorizedService = createAuthorizedService(normalizedService, permissions);
  const wrappedService = {};

  for (const [methodName, method] of Object.entries(authorizedService)) {
    if (typeof method !== "function") {
      continue;
    }

    const methodEvents = events[methodName] || [];
    const eventPublisher = createServiceMethodEventPublisher(
      scope,
      registrationSpec.serviceToken,
      methodName,
      methodEvents
    );

    wrappedService[methodName] = function registeredServiceMethod(...args) {
      if (methodEvents.length < 1) {
        return method(...args);
      }

      const options = resolveMethodOptions(args);
      const result = method(...args);
      const publish = (resolvedResult) =>
        eventPublisher({
          result: resolvedResult,
          args,
          options,
          methodName,
          serviceToken: registrationSpec.serviceToken
        }).then(() => resolvedResult);

      if (result && typeof result.then === "function") {
        return result.then((resolvedResult) => publish(resolvedResult));
      }

      return publish(result);
    };
  }

  Object.defineProperty(wrappedService, "servicePermissions", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: permissions
  });
  Object.defineProperty(wrappedService, "serviceEvents", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: events
  });
  Object.defineProperty(wrappedService, "serviceToken", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: registrationSpec.serviceToken
  });

  return Object.freeze(wrappedService);
}

function normalizeServiceRegistration(value = {}) {
  const source = normalizePlainObject(value);
  if (!isContainerToken(source.serviceToken)) {
    throw new TypeError("app.service requires a valid service token.");
  }
  if (typeof source.factory !== "function") {
    throw new TypeError("app.service requires a factory function.");
  }

  return Object.freeze({
    serviceToken: source.serviceToken,
    factory: source.factory,
    metadata: normalizeServiceMetadata(source.metadata)
  });
}

function registerTaggedServiceRegistration(app, token, factory) {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new Error("registerTaggedServiceRegistration requires application singleton()/tag().");
  }

  app.singleton(token, factory);
  app.tag(token, SERVICE_REGISTRATION_TAG);
}

function resolveServiceRegistrations(scope) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }

  return normalizeArray(scope.resolveTag(SERVICE_REGISTRATION_TAG))
    .map((entry) => normalizePlainObject(entry))
    .filter((entry) => Object.keys(entry).length > 0)
    .sort((left, right) => String(left.serviceToken || "").localeCompare(String(right.serviceToken || "")));
}

function installServiceRegistrationApi(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new Error("installServiceRegistrationApi requires application singleton()/tag().");
  }
  if (typeof app.service === "function") {
    return;
  }

  const registerService = function registerService(serviceToken, factory, metadata = {}) {
    const registration = normalizeServiceRegistration({
      serviceToken,
      factory,
      metadata
    });

    this.singleton(registration.serviceToken, (scope) => materializeServiceRegistration(scope, registration));

    const registrationToken = createServiceRegistrationToken();
    registerTaggedServiceRegistration(this, registrationToken, () =>
      Object.freeze({
        serviceToken: registration.serviceToken,
        metadata: registration.metadata
      })
    );

    return this;
  };

  Object.defineProperty(app, "service", {
    configurable: true,
    writable: true,
    value: registerService
  });
}

export {
  SERVICE_REGISTRATION_TAG,
  normalizeServiceRegistration,
  materializeServiceRegistration,
  registerTaggedServiceRegistration,
  resolveServiceRegistrations,
  installServiceRegistrationApi
};
