import {
  requireCrudNamespace,
  resolveCrudRecordChangedEvent
} from "../shared/crudNamespaceSupport.js";

function normalizeCrudEventEntityId(value = null) {
  return value == null ? "" : String(value).trim();
}

function resolveCrudEntityIdFromResult({ result } = {}) {
  return normalizeCrudEventEntityId(result?.id);
}

function resolveCrudJsonApiEntityIdFromResult({ result } = {}) {
  return normalizeCrudEventEntityId(result?.data?.id);
}

function resolveCrudEntityIdFromArgs({ args = [] } = {}) {
  return normalizeCrudEventEntityId(args[0]);
}

function createCrudServiceEvents(resource = {}, { context = "crudService" } = {}) {
  const namespace = requireCrudNamespace(resource?.namespace, { context: `${context} resource.namespace` });
  const recordChangedEventName = resolveCrudRecordChangedEvent(namespace);

  return Object.freeze({
    createRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "created",
        entityId: resolveCrudEntityIdFromResult,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ]),
    updateRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "updated",
        entityId: resolveCrudEntityIdFromResult,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ]),
    deleteRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "deleted",
        entityId: resolveCrudEntityIdFromResult,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ])
  });
}

function createCrudJsonApiServiceEvents(namespace = "", { context = "createCrudJsonApiServiceEvents" } = {}) {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: `${context} namespace`
  });
  const recordChangedEventName = resolveCrudRecordChangedEvent(normalizedNamespace);

  return Object.freeze({
    createRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "created",
        entityId: resolveCrudJsonApiEntityIdFromResult,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ]),
    updateRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "updated",
        entityId: resolveCrudEntityIdFromArgs,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ]),
    deleteRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "deleted",
        entityId: resolveCrudEntityIdFromArgs,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ])
  });
}

export {
  createCrudServiceEvents,
  createCrudJsonApiServiceEvents,
  resolveCrudEntityIdFromArgs,
  resolveCrudEntityIdFromResult,
  resolveCrudJsonApiEntityIdFromResult
};
