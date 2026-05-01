function rewriteEmbeddedTransportSchemaRefs(value, {
  rootRef = "#",
  definitionRefByName = {}
} = {}) {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteEmbeddedTransportSchemaRefs(entry, {
      rootRef,
      definitionRefByName
    }));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const rewritten = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string") {
      if (entry === "#") {
        rewritten[key] = rootRef;
        continue;
      }

      if (entry.startsWith("#/definitions/")) {
        const definitionName = entry.slice("#/definitions/".length);
        rewritten[key] = definitionRefByName[definitionName] || entry;
        continue;
      }
    }

    rewritten[key] = rewriteEmbeddedTransportSchemaRefs(entry, {
      rootRef,
      definitionRefByName
    });
  }

  return rewritten;
}

function createEmbeddableTransportSchemaDocument(schemaDocument = {}, rootDefinitionName = "TransportSchema") {
  const {
    $schema: _jsonSchemaDraft,
    definitions: sourceDefinitions = {},
    ...rootSchema
  } = schemaDocument || {};

  const rootRef = `#/definitions/${rootDefinitionName}`;
  const definitionRefByName = {};
  const definitions = {};

  for (const definitionName of Object.keys(sourceDefinitions)) {
    definitionRefByName[definitionName] = `#/definitions/${rootDefinitionName}__${definitionName}`;
  }

  definitions[rootDefinitionName] = rewriteEmbeddedTransportSchemaRefs(rootSchema, {
    rootRef,
    definitionRefByName
  });

  for (const [definitionName, definitionSchema] of Object.entries(sourceDefinitions)) {
    definitions[`${rootDefinitionName}__${definitionName}`] = rewriteEmbeddedTransportSchemaRefs(definitionSchema, {
      rootRef,
      definitionRefByName
    });
  }

  return {
    schema: {
      allOf: [{
        $ref: rootRef
      }]
    },
    definitions
  };
}

export {
  rewriteEmbeddedTransportSchemaRefs,
  createEmbeddableTransportSchemaDocument
};
