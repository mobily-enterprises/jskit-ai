import {
  requireCrudNamespace,
  resolveCrudRecordChangedEvent
} from "../shared/crudNamespaceSupport.js";

function createCrudServiceEvents(resource = {}, { context = "crudService" } = {}) {
  const namespace = requireCrudNamespace(resource?.resource, { context: `${context} resource.resource` });
  const recordChangedEventName = resolveCrudRecordChangedEvent(namespace);

  return Object.freeze({
    createRecord: Object.freeze([
      Object.freeze({
        type: "entity.changed",
        source: "crud",
        entity: "record",
        operation: "created",
        entityId: ({ result }) => result?.id,
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
        entityId: ({ result }) => result?.id,
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
        entityId: ({ result }) => result?.id,
        realtime: Object.freeze({
          event: recordChangedEventName,
          audience: "event_scope"
        })
      })
    ])
  });
}

export { createCrudServiceEvents };
