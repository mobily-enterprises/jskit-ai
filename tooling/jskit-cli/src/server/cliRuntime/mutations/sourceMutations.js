import {
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  Project,
  SyntaxKind
} from "ts-morph";
import { createCliError } from "../../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";
import {
  interpolateOptionValue
} from "../../shared/optionInterpolation.js";
import {
  normalizeMutationWhen,
  shouldApplyMutationWhen
} from "../mutationWhen.js";
import {
  loadMutationWhenConfigContext,
  normalizeRelativePath,
  readFileBufferIfExists
} from "../ioAndMigrations.js";
import { normalizeMutationRelativeFilePath } from "./mutationPathUtils.js";

const PRE_FILE_CONFIG_MUTATION_TARGETS = new Set([
  "config/public.js",
  "config/server.js"
]);

function createSourceFile(relativeFile, sourceText) {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true
  });
  return project.createSourceFile(`/${relativeFile}`, sourceText, { overwrite: true });
}

function normalizeSourceText(value = "") {
  return String(value || "").replace(/\r\n/g, "\n");
}

function insertText(sourceText, index, text) {
  return `${sourceText.slice(0, index)}${text}${sourceText.slice(index)}`;
}

function appendBlock(sourceText, block) {
  const normalized = normalizeSourceText(sourceText);
  const trimmed = normalized.replace(/\s*$/u, "");
  if (!trimmed) {
    return `${block.trim()}\n`;
  }
  return `${trimmed}\n\n${block.trim()}\n`;
}

function renderImportMutation(mutation, options, packageId, mutationId) {
  const defaultImport = interpolateOptionValue(
    mutation.defaultImport || "",
    options,
    packageId,
    `${mutationId}.defaultImport`
  ).trim();
  const namespaceImport = interpolateOptionValue(
    mutation.namespaceImport || "",
    options,
    packageId,
    `${mutationId}.namespaceImport`
  ).trim();
  const namedImports = ensureArray(mutation.namedImports)
    .map((entry, index) =>
      interpolateOptionValue(entry, options, packageId, `${mutationId}.namedImports.${index}`).trim()
    )
    .filter(Boolean);
  const from = interpolateOptionValue(mutation.from || "", options, packageId, `${mutationId}.from`).trim();

  if (!from) {
    throw createCliError(`Invalid ensure-import source mutation in ${packageId}: "from" is required.`);
  }
  if (!defaultImport && !namespaceImport && namedImports.length < 1) {
    throw createCliError(
      `Invalid ensure-import source mutation in ${packageId}: defaultImport, namespaceImport, or namedImports is required.`
    );
  }

  let importClause = "";
  if (namespaceImport) {
    importClause = `* as ${namespaceImport}`;
  } else {
    const namedClause = namedImports.length > 0 ? `{ ${namedImports.join(", ")} }` : "";
    importClause = [defaultImport, namedClause].filter(Boolean).join(", ");
  }

  return {
    defaultImport,
    namespaceImport,
    namedImports,
    from,
    statement: `import ${importClause} from "${from}";`
  };
}

function sourceAlreadyHasImport(sourceFile, rendered) {
  return sourceFile.getImportDeclarations().some((importDeclaration) => {
    if (importDeclaration.getModuleSpecifierValue() !== rendered.from) {
      return false;
    }

    const defaultImport = importDeclaration.getDefaultImport()?.getText() || "";
    if (rendered.defaultImport && defaultImport !== rendered.defaultImport) {
      return false;
    }

    const namespaceImport = importDeclaration.getNamespaceImport()?.getText() || "";
    if (rendered.namespaceImport && namespaceImport !== rendered.namespaceImport) {
      return false;
    }

    const existingNamedImports = new Set(
      importDeclaration.getNamedImports().map((namedImport) => namedImport.getName())
    );
    return rendered.namedImports.every((name) => existingNamedImports.has(name));
  });
}

function ensureImport(sourceText, relativeFile, mutation, options, packageId, mutationId) {
  const sourceFile = createSourceFile(relativeFile, sourceText);
  const rendered = renderImportMutation(mutation, options, packageId, mutationId);

  if (sourceAlreadyHasImport(sourceFile, rendered)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const importDeclarations = sourceFile.getImportDeclarations();
  if (importDeclarations.length > 0) {
    const lastImport = importDeclarations[importDeclarations.length - 1];
    return {
      changed: true,
      content: insertText(sourceText, lastImport.getEnd(), `\n${rendered.statement}`)
    };
  }

  const normalized = normalizeSourceText(sourceText);
  return {
    changed: true,
    content: normalized.trim() ? `${rendered.statement}\n\n${normalized}` : `${rendered.statement}\n`
  };
}

function normalizeSourceArg(value = "") {
  const raw = String(value || "").trim();
  const quotedMatch = raw.match(/^(['"])(.*)\1$/u);
  if (!quotedMatch) {
    return raw;
  }
  try {
    return JSON.parse(`"${quotedMatch[2].replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  } catch {
    return quotedMatch[2];
  }
}

function callExpressionMatches(callExpression, callee, expectedArgs, uniqueArgIndex) {
  if (callExpression.getExpression().getText() !== callee) {
    return false;
  }

  const args = callExpression.getArguments();
  if (uniqueArgIndex < 0 || uniqueArgIndex >= expectedArgs.length) {
    return true;
  }
  if (uniqueArgIndex >= args.length) {
    return false;
  }

  return normalizeSourceArg(args[uniqueArgIndex].getText()) === normalizeSourceArg(expectedArgs[uniqueArgIndex]);
}

function renderCallMutation(mutation, options, packageId, mutationId) {
  const callee = interpolateOptionValue(mutation.callee || "", options, packageId, `${mutationId}.callee`).trim();
  const args = ensureArray(mutation.args)
    .map((entry, index) => interpolateOptionValue(entry, options, packageId, `${mutationId}.args.${index}`).trim())
    .filter(Boolean);

  if (!callee) {
    throw createCliError(`Invalid ensure-call source mutation in ${packageId}: "callee" is required.`);
  }

  return {
    callee,
    args,
    statement: `${callee}(${args.join(", ")});`
  };
}

function ensureCall(sourceText, relativeFile, mutation, options, packageId, mutationId) {
  const sourceFile = createSourceFile(relativeFile, sourceText);
  const rendered = renderCallMutation(mutation, options, packageId, mutationId);
  const uniqueArgIndex = Number.isInteger(mutation.uniqueArgIndex)
    ? mutation.uniqueArgIndex
    : 0;
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  if (callExpressions.some((callExpression) =>
    callExpressionMatches(callExpression, rendered.callee, rendered.args, uniqueArgIndex)
  )) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const beforeClass = String(mutation.beforeClass || "").trim();
  if (beforeClass) {
    const classDeclaration = sourceFile.getClass(beforeClass);
    if (!classDeclaration) {
      throw createCliError(
        `Invalid ensure-call source mutation in ${packageId}: beforeClass "${beforeClass}" was not found in ${relativeFile}.`
      );
    }
    return {
      changed: true,
      content: insertText(sourceText, classDeclaration.getStart(), `${rendered.statement}\n\n`)
    };
  }

  return {
    changed: true,
    content: appendBlock(sourceText, rendered.statement)
  };
}

function sourceHasAssignmentToTarget(sourceFile, target) {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some((expression) => expression.getLeft().getText() === target);
}

function renderAssignmentStatement(target, value) {
  return `${target} = ${value};`;
}

function ensureAssignment(sourceText, relativeFile, mutation, options, packageId, mutationId) {
  const sourceFile = createSourceFile(relativeFile, sourceText);
  const target = interpolateOptionValue(mutation.target || "", options, packageId, `${mutationId}.target`).trim();
  const value = interpolateOptionValue(mutation.value || "", options, packageId, `${mutationId}.value`).trim();
  if (!target) {
    throw createCliError(`Invalid ensure-assignment source mutation in ${packageId}: "target" is required.`);
  }
  if (!value) {
    throw createCliError(`Invalid ensure-assignment source mutation in ${packageId}: "value" is required.`);
  }

  const statements = [];
  for (const rawEnsureTarget of ensureArray(mutation.ensureObjects)) {
    const ensureTarget = interpolateOptionValue(
      rawEnsureTarget,
      options,
      packageId,
      `${mutationId}.ensureObjects`
    ).trim();
    if (!ensureTarget || sourceHasAssignmentToTarget(sourceFile, ensureTarget)) {
      continue;
    }
    statements.push(`${ensureTarget} ||= {};`);
  }

  if (!sourceHasAssignmentToTarget(sourceFile, target)) {
    statements.push(renderAssignmentStatement(target, value));
  }

  if (statements.length < 1) {
    return {
      changed: false,
      content: sourceText
    };
  }

  return {
    changed: true,
    content: appendBlock(sourceText, statements.join("\n"))
  };
}

function ensureExportConst(sourceText, relativeFile, mutation, options, packageId, mutationId) {
  const sourceFile = createSourceFile(relativeFile, sourceText);
  const name = interpolateOptionValue(mutation.name || "", options, packageId, `${mutationId}.name`).trim();
  const value = interpolateOptionValue(mutation.value || "{}", options, packageId, `${mutationId}.value`).trim() || "{}";
  if (!name) {
    throw createCliError(`Invalid ensure-export-const source mutation in ${packageId}: "name" is required.`);
  }

  if (sourceFile.getVariableDeclaration(name)) {
    return {
      changed: false,
      content: sourceText
    };
  }

  const statement = `export const ${name} = ${value};`;
  const importDeclarations = sourceFile.getImportDeclarations();
  if (importDeclarations.length > 0) {
    const lastImport = importDeclarations[importDeclarations.length - 1];
    return {
      changed: true,
      content: insertText(sourceText, lastImport.getEnd(), `\n\n${statement}`)
    };
  }

  const normalized = normalizeSourceText(sourceText);
  return {
    changed: true,
    content: normalized.trim() ? `${statement}\n\n${normalized}` : `${statement}\n`
  };
}

function applySourceMutationToContent(sourceText, relativeFile, mutation, options, packageId) {
  const operation = String(mutation?.op || "").trim();
  const mutationId = String(mutation?.id || "").trim() || operation || "source";

  if (operation === "ensure-import") {
    return ensureImport(sourceText, relativeFile, mutation, options, packageId, mutationId);
  }
  if (operation === "ensure-call") {
    return ensureCall(sourceText, relativeFile, mutation, options, packageId, mutationId);
  }
  if (operation === "ensure-assignment") {
    return ensureAssignment(sourceText, relativeFile, mutation, options, packageId, mutationId);
  }
  if (operation === "ensure-export-const") {
    return ensureExportConst(sourceText, relativeFile, mutation, options, packageId, mutationId);
  }

  throw createCliError(`Unsupported source mutation op "${operation}" in ${packageId}.`);
}

function createManagedSourceRecord(relativeFile, mutation) {
  const mutationId = String(mutation?.id || "").trim() || String(mutation?.op || "source").trim();
  const recordKey = `${relativeFile}::${mutationId}`;
  return {
    recordKey,
    record: {
      file: relativeFile,
      op: String(mutation?.op || "").trim(),
      id: String(mutation?.id || ""),
      reason: String(mutation?.reason || ""),
      category: String(mutation?.category || "")
    }
  };
}

async function applySourceMutations(
  packageEntry,
  appRoot,
  sourceMutations,
  options,
  managedSource,
  touchedFiles,
  { dryRun = false } = {}
) {
  for (const mutation of sourceMutations) {
    const when = normalizeMutationWhen(mutation?.when);
    const configContext = when?.config ? await loadMutationWhenConfigContext(appRoot) : {};
    if (
      !shouldApplyMutationWhen(when, {
        options,
        configContext,
        packageId: packageEntry.packageId,
        mutationContext: "source mutation"
      })
    ) {
      continue;
    }

    const relativeFile = normalizeMutationRelativeFilePath(mutation?.file || "");
    if (!relativeFile) {
      throw createCliError(`Invalid source mutation in ${packageEntry.packageId}: "file" is required.`);
    }

    const absoluteFile = path.join(appRoot, relativeFile);
    const previous = await readFileBufferIfExists(absoluteFile);
    const previousContent = previous.exists ? previous.buffer.toString("utf8") : "";
    const applied = applySourceMutationToContent(
      normalizeSourceText(previousContent),
      relativeFile,
      mutation,
      options,
      packageEntry.packageId
    );
    const {
      recordKey,
      record
    } = createManagedSourceRecord(relativeFile, mutation);
    if (!applied.changed) {
      managedSource[recordKey] = record;
      continue;
    }

    if (!dryRun) {
      await mkdir(path.dirname(absoluteFile), { recursive: true });
      await writeFile(absoluteFile, applied.content, "utf8");
    }

    managedSource[recordKey] = record;
    touchedFiles.add(normalizeRelativePath(appRoot, absoluteFile));
  }
}

function isPositioningSourceMutation(value = {}) {
  const mutation = ensureObject(value);
  const operation = String(mutation.op || "").trim();
  if (operation !== "ensure-call") {
    return false;
  }
  return normalizeMutationRelativeFilePath(mutation.file) === "src/placement.js";
}

function isPreFileConfigSourceMutation(value = {}) {
  const mutation = ensureObject(value);
  const operation = String(mutation.op || "").trim();
  if (operation !== "ensure-assignment" && operation !== "ensure-export-const") {
    return false;
  }
  return PRE_FILE_CONFIG_MUTATION_TARGETS.has(normalizeMutationRelativeFilePath(mutation.file));
}

function partitionPreFileConfigSourceMutations(sourceMutations = []) {
  const preFileSourceMutations = [];
  const postFileSourceMutations = [];

  for (const mutation of ensureArray(sourceMutations)) {
    if (isPreFileConfigSourceMutation(mutation)) {
      preFileSourceMutations.push(mutation);
      continue;
    }
    postFileSourceMutations.push(mutation);
  }

  return {
    preFileSourceMutations,
    postFileSourceMutations
  };
}

function resolvePositioningSourceMutations(descriptorMutations = {}) {
  const mutations = ensureObject(descriptorMutations);
  return ensureArray(mutations.source).filter((mutationValue) => isPositioningSourceMutation(mutationValue));
}

export {
  applySourceMutations,
  partitionPreFileConfigSourceMutations,
  resolvePositioningSourceMutations
};
