import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";

function maskNonCode(source = "") {
  const characters = [...String(source || "")];
  const masked = [...characters];
  let state = "code";

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const nextCharacter = characters[index + 1] || "";

    if (state === "code") {
      if (character === "/" && nextCharacter === "/") {
        masked[index] = " ";
        masked[index + 1] = " ";
        state = "line-comment";
        index += 1;
      } else if (character === "/" && nextCharacter === "*") {
        masked[index] = " ";
        masked[index + 1] = " ";
        state = "block-comment";
        index += 1;
      } else if (character === "'") {
        masked[index] = " ";
        state = "single-quote";
      } else if (character === "\"") {
        masked[index] = " ";
        state = "double-quote";
      } else if (character === "`") {
        masked[index] = " ";
        state = "template";
      }
      continue;
    }

    if (character === "\n" && state === "line-comment") {
      state = "code";
      continue;
    }

    if (character === "\n") {
      continue;
    }

    masked[index] = " ";
    if (character === "\\" && ["single-quote", "double-quote", "template"].includes(state)) {
      if (index + 1 < characters.length) {
        masked[index + 1] = " ";
        index += 1;
      }
      continue;
    }
    if (state === "block-comment" && character === "*" && nextCharacter === "/") {
      masked[index + 1] = " ";
      state = "code";
      index += 1;
    } else if (state === "single-quote" && character === "'") {
      state = "code";
    } else if (state === "double-quote" && character === "\"") {
      state = "code";
    } else if (state === "template" && character === "`") {
      state = "code";
    }
  }

  return masked.join("");
}

function findMatchingDelimiter(source, openIndex, openCharacter, closeCharacter) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === openCharacter) {
      depth += 1;
    } else if (source[index] === closeCharacter) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findMutationsFilesArray(source = "") {
  const masked = maskNonCode(source);
  const mutationsPattern = /\bmutations\s*:/gu;
  const mutationsMatches = [...masked.matchAll(mutationsPattern)];
  if (mutationsMatches.length !== 1) {
    return null;
  }

  let mutationsOpenIndex = mutationsMatches[0].index + mutationsMatches[0][0].length;
  while (/\s/u.test(masked[mutationsOpenIndex] || "")) {
    mutationsOpenIndex += 1;
  }
  if (masked[mutationsOpenIndex] !== "{") {
    return null;
  }

  const mutationsCloseIndex = findMatchingDelimiter(masked, mutationsOpenIndex, "{", "}");
  if (mutationsCloseIndex < 0) {
    return null;
  }

  let objectDepth = 1;
  let arrayDepth = 0;
  let parenthesisDepth = 0;
  for (let index = mutationsOpenIndex + 1; index < mutationsCloseIndex; index += 1) {
    if (
      objectDepth === 1 &&
      arrayDepth === 0 &&
      parenthesisDepth === 0 &&
      masked.startsWith("files", index) &&
      !/[A-Za-z0-9_$]/u.test(masked[index - 1] || "") &&
      !/[A-Za-z0-9_$]/u.test(masked[index + 5] || "")
    ) {
      let colonIndex = index + 5;
      while (/\s/u.test(masked[colonIndex] || "")) {
        colonIndex += 1;
      }
      if (masked[colonIndex] !== ":") {
        continue;
      }
      let arrayOpenIndex = colonIndex + 1;
      while (/\s/u.test(masked[arrayOpenIndex] || "")) {
        arrayOpenIndex += 1;
      }
      if (masked[arrayOpenIndex] !== "[") {
        return null;
      }
      const arrayCloseIndex = findMatchingDelimiter(masked, arrayOpenIndex, "[", "]");
      if (arrayCloseIndex < 0 || arrayCloseIndex > mutationsCloseIndex) {
        return null;
      }
      return {
        arrayCloseIndex,
        arrayOpenIndex,
        filesIndex: index,
        masked
      };
    }

    const character = masked[index];
    if (character === "{") {
      objectDepth += 1;
    } else if (character === "}") {
      objectDepth -= 1;
    } else if (character === "[") {
      arrayDepth += 1;
    } else if (character === "]") {
      arrayDepth -= 1;
    } else if (character === "(") {
      parenthesisDepth += 1;
    } else if (character === ")") {
      parenthesisDepth -= 1;
    }
  }

  return null;
}

function lineIndentAt(source = "", index = 0) {
  const lineStart = source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  return (/^\s*/u.exec(source.slice(lineStart, index)) || [""])[0];
}

function renderInstallMigrationMutation({
  from,
  id,
  indent
} = {}) {
  const nestedIndent = `${indent}  `;
  return [
    `${indent}{`,
    `${nestedIndent}op: "install-migration",`,
    `${nestedIndent}from: ${JSON.stringify(from)},`,
    `${nestedIndent}toDir: "migrations",`,
    `${nestedIndent}extension: ".cjs",`,
    `${nestedIndent}reason: ${JSON.stringify(`Apply package-owned additive schema evolution ${id}.`)},`,
    `${nestedIndent}category: "schema-evolution",`,
    `${nestedIndent}id: ${JSON.stringify(id)}`,
    `${indent}}`
  ].join("\n");
}

function addInstallMigrationMutationToDescriptor(source = "", mutation = {}) {
  const filesArray = findMutationsFilesArray(source);
  if (!filesArray) {
    return null;
  }

  const propertyIndent = lineIndentAt(source, filesArray.filesIndex);
  const itemIndent = `${propertyIndent}  `;
  const renderedMutation = renderInstallMigrationMutation({
    ...mutation,
    indent: itemIndent
  });
  const innerMasked = filesArray.masked.slice(
    filesArray.arrayOpenIndex + 1,
    filesArray.arrayCloseIndex
  );
  const hasExistingItems = /\S/u.test(innerMasked);

  if (!hasExistingItems) {
    return [
      source.slice(0, filesArray.arrayOpenIndex + 1),
      `\n${renderedMutation}\n${propertyIndent}`,
      source.slice(filesArray.arrayCloseIndex)
    ].join("");
  }

  let lastContentIndex = filesArray.arrayCloseIndex - 1;
  while (lastContentIndex > filesArray.arrayOpenIndex && /\s/u.test(filesArray.masked[lastContentIndex])) {
    lastContentIndex -= 1;
  }
  const separator = filesArray.masked[lastContentIndex] === "," ? "" : ",";
  return [
    source.slice(0, lastContentIndex + 1),
    `${separator}\n${renderedMutation}`,
    source.slice(lastContentIndex + 1)
  ].join("");
}

function createMigrationTemplate({ packageId, migrationId } = {}) {
  return `/**
 * Package-owned additive migration: ${migrationId}
 *
 * Implement this source before materializing it. Once JSKIT installs a
 * migration, its id and content are immutable; later changes require another
 * additive migration.
 *
 * Never edit or replace a generator-owned baseline migration. SQL or Knex
 * schema operations belong here, not in an ad-hoc command applied only to one
 * database.
 *
 * Owner: ${packageId}
 */
exports.up = async function up(knex) {
  void knex;
  throw new Error("Implement migration ${migrationId} before materializing it.");
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Implement rollback ${migrationId} before materializing it.");
};
`;
}

async function writeMigrationSourceAndDescriptor({
  descriptorPath,
  descriptorSource,
  migrationPath,
  migrationSource,
  mkdir,
  rename,
  rm,
  writeFile,
  path
} = {}) {
  const uniqueSuffix = `.jskit-create-${process.pid}-${Date.now()}`;
  const descriptorTemporaryPath = `${descriptorPath}${uniqueSuffix}`;
  const migrationTemporaryPath = `${migrationPath}${uniqueSuffix}`;
  let migrationInstalled = false;

  await mkdir(path.dirname(migrationPath), { recursive: true });
  try {
    await writeFile(migrationTemporaryPath, migrationSource, { encoding: "utf8", flag: "wx" });
    await writeFile(descriptorTemporaryPath, descriptorSource, { encoding: "utf8", flag: "wx" });
    await rename(migrationTemporaryPath, migrationPath);
    migrationInstalled = true;
    await rename(descriptorTemporaryPath, descriptorPath);
  } catch (error) {
    await rm(migrationTemporaryPath, { force: true }).catch(() => {});
    await rm(descriptorTemporaryPath, { force: true }).catch(() => {});
    if (migrationInstalled) {
      await rm(migrationPath, { force: true }).catch(() => {});
    }
    throw error;
  }
}

async function runMigrationCreateCommand(ctx = {}, { options, cwd, io }) {
  const {
    createCliError,
    fileExists,
    loadAppLocalPackageRegistry,
    loadLockFile,
    mkdir,
    normalizeMigrationId,
    normalizeRelativePath,
    normalizeRelativePosixPath,
    path,
    readFileBufferIfExists,
    rename,
    resolveAppRootFromCwd,
    resolveInstalledPackageIdInput,
    rm,
    writeFile
  } = ctx;
  const inlineOptions = ensureObject(options.inlineOptions);
  const unsupportedMigrationOptions = ["scope", "package-id", "description"].filter((optionName) =>
    Object.prototype.hasOwnProperty.call(inlineOptions, optionName)
  );
  if (options.runNpmInstall === true) {
    unsupportedMigrationOptions.push("run-npm-install");
  }
  if (unsupportedMigrationOptions.length > 0) {
    throw createCliError(
      `Unknown option${unsupportedMigrationOptions.length === 1 ? "" : "s"} for create migration: ${unsupportedMigrationOptions.map((optionName) => `--${optionName}`).join(", ")}.`
    );
  }
  const requestedPackageId = String(inlineOptions.package || "").trim();
  const rawMigrationId = String(inlineOptions.id || "").trim();
  if (!requestedPackageId || !rawMigrationId) {
    throw createCliError(
      "create migration requires: create migration --package <app-local-package-id> --id <migration-id>",
      { showUsage: true }
    );
  }

  const appRoot = await resolveAppRootFromCwd(cwd);
  const { lock } = await loadLockFile(appRoot);
  const installedPackages = ensureObject(lock.installedPackages);
  const packageId = resolveInstalledPackageIdInput(requestedPackageId, installedPackages);
  if (!packageId) {
    throw createCliError(`Package is not installed: ${requestedPackageId}`);
  }

  const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
  const packageEntry = appLocalRegistry.get(packageId);
  if (!packageEntry) {
    throw createCliError(
      `Migration owner must be an app-local package under packages/: ${packageId}`
    );
  }

  const migrationId = normalizeMigrationId(rawMigrationId, packageId);
  const declaredFileMutations = ensureArray(packageEntry.descriptor?.mutations?.files);
  if (declaredFileMutations.some((mutationValue) => {
    const mutation = ensureObject(mutationValue);
    return String(mutation.id || "").trim() === migrationId;
  })) {
    throw createCliError(
      `${packageId} already declares a file mutation with id ${migrationId}. Use a new immutable migration id.`
    );
  }

  const descriptorPath = path.join(packageEntry.rootDir, "package.descriptor.mjs");
  const migrationFrom = `templates/migrations/${migrationId}.cjs`;
  const migrationPath = path.join(packageEntry.rootDir, ...migrationFrom.split("/"));
  if (await fileExists(migrationPath)) {
    throw createCliError(
      `Migration source already exists: ${normalizeRelativePath(appRoot, migrationPath)}`
    );
  }

  const descriptorRead = await readFileBufferIfExists(descriptorPath);
  if (!descriptorRead.exists) {
    throw createCliError(
      `App-local package descriptor is missing: ${normalizeRelativePath(appRoot, descriptorPath)}`
    );
  }
  const descriptorSource = descriptorRead.buffer.toString("utf8");
  const nextDescriptorSource = addInstallMigrationMutationToDescriptor(descriptorSource, {
    from: migrationFrom,
    id: migrationId
  });
  if (!nextDescriptorSource) {
    throw createCliError(
      `${normalizeRelativePath(appRoot, descriptorPath)} must declare mutations.files as an array before creating a migration.`
    );
  }

  const migrationSource = createMigrationTemplate({
    packageId,
    migrationId
  });
  const touchedFiles = sortStrings([
    normalizeRelativePosixPath(normalizeRelativePath(appRoot, descriptorPath)),
    normalizeRelativePosixPath(normalizeRelativePath(appRoot, migrationPath))
  ]);

  if (!options.dryRun) {
    await writeMigrationSourceAndDescriptor({
      descriptorPath,
      descriptorSource: nextDescriptorSource,
      migrationPath,
      migrationSource,
      mkdir,
      rename,
      rm,
      writeFile,
      path
    });
  }

  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      targetType: "migration",
      packageId,
      migrationId,
      templatePath: normalizeRelativePosixPath(normalizeRelativePath(appRoot, migrationPath)),
      descriptorPath: normalizeRelativePosixPath(normalizeRelativePath(appRoot, descriptorPath)),
      touchedFiles,
      dryRun: options.dryRun
    }, null, 2)}\n`);
  } else {
    io.stdout.write(`Created package-owned migration source ${migrationId} for ${packageId}.\n`);
    io.stdout.write(`Template: ${normalizeRelativePath(appRoot, migrationPath)}\n`);
    io.stdout.write(`Descriptor: ${normalizeRelativePath(appRoot, descriptorPath)}\n`);
    io.stdout.write("Implement and test the template before materializing it.\n");
    io.stdout.write(`Then run: npx jskit migrations package ${packageId}\n`);
    if (options.dryRun) {
      io.stdout.write("Dry run enabled: no files were written.\n");
    }
  }

  return 0;
}

export {
  addInstallMigrationMutationToDescriptor,
  createMigrationTemplate,
  runMigrationCreateCommand
};
