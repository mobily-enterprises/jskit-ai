import {
  readdir,
  readFile
} from "node:fs/promises";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";
import {
  UI_VERIFICATION_RECEIPT_RELATIVE_PATH,
  isValidUiVerificationReceipt,
  normalizeUiVerificationReceipt,
  resolveChangedUiFilesFromGit
} from "../shared/uiVerification.js";

function createHealthCommands(ctx = {}) {
  const {
    directoryLooksLikeJskitAppRoot,
    resolveAppRootFromCwd,
    loadLockFile,
    loadPackageRegistry,
    loadBundleRegistry,
    loadAppLocalPackageRegistry,
    mergePackageRegistries,
    hydratePackageRegistryFromInstalledNodeModules,
    inspectPackageOfferings,
    fileExists,
    normalizeRelativePath,
    path
  } = ctx;

  const APP_SOURCE_SCAN_ROOTS = Object.freeze([
    "src",
    "packages"
  ]);
  const APP_SOURCE_IGNORED_DIRECTORY_NAMES = new Set([
    ".git",
    ".jskit",
    ".build",
    "coverage",
    "dist",
    "docs",
    "LEGACY",
    "node_modules",
    "test",
    "tests",
    "__tests__"
  ]);
  const APP_SOURCE_IGNORED_FILE_PATTERNS = Object.freeze([
    /\.spec\./i,
    /\.test\./i,
    /\.vitest\./i
  ]);
  const APP_SOURCE_CODE_EXTENSIONS = new Set([
    ".cjs",
    ".js",
    ".jsx",
    ".mjs",
    ".ts",
    ".tsx",
    ".vue"
  ]);
  const VUE_SOURCE_EXTENSIONS = new Set([".vue"]);
  const MDI_SVG_MAIN_ENTRY_CANDIDATES = Object.freeze([
    "src/main.js",
    "src/main.mjs",
    "src/main.ts"
  ]);
  const DIRECT_MDI_LITERAL_ICON_PATTERN =
    /<(v-[a-z0-9-]+)[^>]*?\b(icon|prepend-icon|append-icon)\s*=\s*(['"])(mdi-[^'"]+)\3/gi;
  const DIRECT_MDI_BOUND_LITERAL_ICON_PATTERN =
    /<(v-[a-z0-9-]+)[^>]*?(?::|v-bind:)(icon|prepend-icon|append-icon)\s*=\s*(['"])(['"])(mdi-[^'"]+)\4\3/gi;
  const FILTER_RUNTIME_CALLEES = Object.freeze([
    "createCrudListFilters",
    "useCrudListFilters"
  ]);

  function collectDescriptorContainerTokens({ packageId, side, values, issues }) {
    const declaredTokens = new Set();
    const duplicateTokens = new Set();
    let invalidCount = 0;

    for (const rawValue of ensureArray(values)) {
      if (typeof rawValue !== "string") {
        invalidCount += 1;
        continue;
      }
      const token = rawValue.trim();
      if (!token) {
        invalidCount += 1;
        continue;
      }
      if (declaredTokens.has(token)) {
        duplicateTokens.add(token);
        continue;
      }
      declaredTokens.add(token);
    }

    if (invalidCount > 0) {
      issues.push({
        packageId,
        side,
        code: "descriptor-token-invalid",
        message: `${packageId} (${side}): metadata.apiSummary.containerTokens includes ${invalidCount} non-string or empty token value(s).`
      });
    }
    for (const token of sortStrings([...duplicateTokens])) {
      issues.push({
        packageId,
        side,
        code: "descriptor-token-duplicate",
        token,
        message: `${packageId} (${side}): descriptor token is declared more than once: ${token}.`
      });
    }

    return declaredTokens;
  }

  function collectUsedContainerTokens({ packageId, side, bindings, issues }) {
    const usedTokens = new Set();
    for (const rawBinding of ensureArray(bindings)) {
      const binding = ensureObject(rawBinding);
      const tokenExpression = String(binding.tokenExpression || "").trim();
      const token = String(binding.token || "").trim();
      const location = String(binding.location || "").trim();
      if (binding.tokenResolved !== true || !token) {
        const expressionLabel = tokenExpression || "<empty>";
        const locationSuffix = location ? ` at ${location}` : "";
        issues.push({
          packageId,
          side,
          code: "binding-token-unresolved",
          tokenExpression: expressionLabel,
          location,
          message: `${packageId} (${side}): unresolved DI token expression "${expressionLabel}"${locationSuffix}.`
        });
        continue;
      }
      usedTokens.add(token);
    }
    return usedTokens;
  }

  function collectProviderIntrospectionIssues({ packageId, packageInsights, issues }) {
    const introspection = ensureObject(packageInsights);
    if (!introspection.available) {
      issues.push({
        packageId,
        side: "",
        code: "provider-introspection-unavailable",
        message: `${packageId}: provider source introspection is unavailable, so DI token parity cannot be verified.`
      });
      return;
    }

    const notes = ensureArray(introspection.notes).map((value) => String(value || "").trim()).filter(Boolean);
    for (const note of notes) {
      if (
        note.startsWith("Skipped wildcard provider entrypoint during introspection:") ||
        note.startsWith("Provider file missing during introspection:") ||
        note.startsWith("Failed reading provider ")
      ) {
        issues.push({
          packageId,
          side: "",
          code: "provider-introspection-incomplete",
          message: `${packageId}: ${note}`
        });
      }
    }
  }

  function shouldSkipAppSourceDirectory(directoryName = "") {
    return APP_SOURCE_IGNORED_DIRECTORY_NAMES.has(String(directoryName || "").trim());
  }

  function shouldSkipAppSourceFile(
    fileName = "",
    {
      extensions = APP_SOURCE_CODE_EXTENSIONS,
      ignoredFilePatterns = APP_SOURCE_IGNORED_FILE_PATTERNS
    } = {}
  ) {
    const normalizedFileName = String(fileName || "").trim();
    const extension = path.extname(normalizedFileName).toLowerCase();
    if (!extensions.has(extension)) {
      return true;
    }
    return ignoredFilePatterns.some((pattern) => pattern.test(normalizedFileName));
  }

  async function collectAppSourceFiles(
    rootDirectory,
    {
      extensions = APP_SOURCE_CODE_EXTENSIONS,
      ignoredFilePatterns = APP_SOURCE_IGNORED_FILE_PATTERNS
    } = {},
    collected = []
  ) {
    if (!(await fileExists(rootDirectory))) {
      return collected;
    }

    const entries = await readdir(rootDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(rootDirectory, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipAppSourceDirectory(entry.name)) {
          continue;
        }
        await collectAppSourceFiles(
          entryPath,
          {
            extensions,
            ignoredFilePatterns
          },
          collected
        );
        continue;
      }
      if (
        entry.isFile() &&
        !shouldSkipAppSourceFile(entry.name, {
          extensions,
          ignoredFilePatterns
        })
      ) {
        collected.push(entryPath);
      }
    }

    return collected;
  }

  async function appUsesVuetifyMdiSvg(appRoot) {
    for (const relativePath of MDI_SVG_MAIN_ENTRY_CANDIDATES) {
      const absolutePath = path.join(appRoot, relativePath);
      if (!(await fileExists(absolutePath))) {
        continue;
      }
      const fileContent = await readFile(absolutePath, "utf8");
      if (fileContent.includes("vuetify/iconsets/mdi-svg")) {
        return true;
      }
    }

    return false;
  }

  function resolveLineNumberFromIndex(sourceText = "", index = 0) {
    return String(sourceText || "").slice(0, Math.max(0, index)).split("\n").length;
  }

  function collectDirectMdiSvgTemplateIconIssues({ sourceText, relativePath, issues }) {
    DIRECT_MDI_LITERAL_ICON_PATTERN.lastIndex = 0;
    for (const match of sourceText.matchAll(DIRECT_MDI_LITERAL_ICON_PATTERN)) {
      const [, tagName = "v-component", propName = "icon", , rawIcon = ""] = match;
      const lineNumber = resolveLineNumberFromIndex(sourceText, match.index || 0);
      issues.push(
        `${relativePath}:${lineNumber}: raw "${rawIcon}" passed to <${tagName}> ${propName} while the app uses vuetify/iconsets/mdi-svg. Use an @mdi/js path or a Vuetify alias.`
      );
    }

    DIRECT_MDI_BOUND_LITERAL_ICON_PATTERN.lastIndex = 0;
    for (const match of sourceText.matchAll(DIRECT_MDI_BOUND_LITERAL_ICON_PATTERN)) {
      const [, tagName = "v-component", propName = "icon", , , rawIcon = ""] = match;
      const lineNumber = resolveLineNumberFromIndex(sourceText, match.index || 0);
      issues.push(
        `${relativePath}:${lineNumber}: raw "${rawIcon}" passed to <${tagName}> ${propName} while the app uses vuetify/iconsets/mdi-svg. Use an @mdi/js path or a Vuetify alias.`
      );
    }
  }

  function isEscapedCharacter(sourceText = "", index = 0) {
    let backslashCount = 0;
    for (let position = index - 1; position >= 0 && sourceText[position] === "\\"; position -= 1) {
      backslashCount += 1;
    }
    return backslashCount % 2 === 1;
  }

  function findClosingParenIndex(sourceText = "", openParenIndex = -1) {
    if (openParenIndex < 0 || sourceText[openParenIndex] !== "(") {
      return -1;
    }

    let parenDepth = 0;
    let quote = "";
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = openParenIndex; index < sourceText.length; index += 1) {
      const character = sourceText[index];
      const nextCharacter = sourceText[index + 1] || "";

      if (inLineComment) {
        if (character === "\n") {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (character === "*" && nextCharacter === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (character === quote && !isEscapedCharacter(sourceText, index)) {
          quote = "";
        }
        continue;
      }

      if (character === "/" && nextCharacter === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (character === "/" && nextCharacter === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (character === "'" || character === "\"" || character === "`") {
        quote = character;
        continue;
      }

      if (character === "(") {
        parenDepth += 1;
        continue;
      }

      if (character === ")") {
        parenDepth -= 1;
        if (parenDepth === 0) {
          return index;
        }
      }
    }

    return -1;
  }

  function extractFirstArgumentText(argsText = "") {
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote = "";
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < argsText.length; index += 1) {
      const character = argsText[index];
      const nextCharacter = argsText[index + 1] || "";

      if (inLineComment) {
        if (character === "\n") {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (character === "*" && nextCharacter === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (character === quote && !isEscapedCharacter(argsText, index)) {
          quote = "";
        }
        continue;
      }

      if (character === "/" && nextCharacter === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (character === "/" && nextCharacter === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (character === "'" || character === "\"" || character === "`") {
        quote = character;
        continue;
      }

      if (character === "(") {
        parenDepth += 1;
        continue;
      }
      if (character === ")") {
        parenDepth -= 1;
        continue;
      }
      if (character === "{") {
        braceDepth += 1;
        continue;
      }
      if (character === "}") {
        braceDepth -= 1;
        continue;
      }
      if (character === "[") {
        bracketDepth += 1;
        continue;
      }
      if (character === "]") {
        bracketDepth -= 1;
        continue;
      }

      if (character === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        return argsText.slice(0, index);
      }
    }

    return argsText;
  }

  function collectStaticImportBindings(sourceText = "") {
    const bindings = new Map();
    const importPattern = /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gmu;

    for (const match of sourceText.matchAll(importPattern)) {
      const specifierText = String(match[1] || "").trim();
      const sourcePath = String(match[2] || "").trim();
      if (!specifierText || !sourcePath) {
        continue;
      }

      const namedMatch = specifierText.match(/\{([\s\S]*)\}/u);
      if (namedMatch) {
        const namedContent = String(namedMatch[1] || "");
        for (const rawSpecifier of namedContent.split(",")) {
          const specifier = String(rawSpecifier || "").trim();
          if (!specifier) {
            continue;
          }
          const aliasMatch = specifier.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u);
          const localName = aliasMatch ? aliasMatch[2] : specifier;
          if (/^[A-Za-z_$][\w$]*$/u.test(localName)) {
            bindings.set(localName, sourcePath);
          }
        }
      }

      const leadingSpecifier = namedMatch
        ? specifierText.slice(0, namedMatch.index).replace(/,$/u, "").trim()
        : specifierText;
      if (!leadingSpecifier) {
        continue;
      }

      const namespaceMatch = leadingSpecifier.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/u);
      if (namespaceMatch) {
        bindings.set(namespaceMatch[1], sourcePath);
        continue;
      }

      if (/^[A-Za-z_$][\w$]*$/u.test(leadingSpecifier)) {
        bindings.set(leadingSpecifier, sourcePath);
      }
    }

    return bindings;
  }

  function isSharedListFiltersImportSource(sourcePath = "") {
    return /(^|\/)shared\/[^/'"]*ListFilters(?:\.[A-Za-z0-9]+)?$/u.test(String(sourcePath || "").trim());
  }

  function findCallSites(sourceText = "", calleeName = "") {
    const normalizedCalleeName = String(calleeName || "").trim();
    if (!normalizedCalleeName) {
      return [];
    }

    const callPattern = new RegExp(`\\b${normalizedCalleeName}\\s*\\(`, "gu");
    const calls = [];

    for (const match of sourceText.matchAll(callPattern)) {
      const matchedText = String(match[0] || "");
      const openParenIndex = (match.index || 0) + matchedText.lastIndexOf("(");
      const closeParenIndex = findClosingParenIndex(sourceText, openParenIndex);
      if (closeParenIndex < 0) {
        continue;
      }

      calls.push({
        calleeName: normalizedCalleeName,
        index: match.index || 0,
        openParenIndex,
        closeParenIndex,
        argsText: sourceText.slice(openParenIndex + 1, closeParenIndex)
      });
    }

    return calls;
  }

  function collectFilterDefinitionOwnershipIssues({
    sourceText = "",
    relativePath = "",
    issues = []
  }) {
    const importBindings = collectStaticImportBindings(sourceText);

    for (const calleeName of FILTER_RUNTIME_CALLEES) {
      for (const callSite of findCallSites(sourceText, calleeName)) {
        const lineNumber = resolveLineNumberFromIndex(sourceText, callSite.index);
        const firstArgument = extractFirstArgumentText(callSite.argsText).trim();

        if (!firstArgument || firstArgument.startsWith("{")) {
          issues.push(
            `${relativePath}:${lineNumber}: [filters:shared-definition] do not inline structured filter definitions in ${calleeName}(...). Put them in packages/<crud>/src/shared/<crud>ListFilters.js and import that shared module.`
          );
          continue;
        }

        if (!/^[A-Za-z_$][\w$]*$/u.test(firstArgument)) {
          issues.push(
            `${relativePath}:${lineNumber}: [filters:shared-definition] ${calleeName}(...) must receive a definitions symbol imported from a CRUD shared *ListFilters module, not an ad-hoc expression.`
          );
          continue;
        }

        const importSource = importBindings.get(firstArgument) || "";
        if (!isSharedListFiltersImportSource(importSource)) {
          issues.push(
            `${relativePath}:${lineNumber}: [filters:shared-definition] ${calleeName}(${firstArgument}, ...) must use definitions imported from a CRUD shared *ListFilters module. Found ${importSource ? `import source "${importSource}"` : "a local symbol"} instead.`
          );
        }
      }
    }
  }

  function collectFilterValidatorModeIssues({
    sourceText = "",
    relativePath = "",
    issues = []
  }) {
    for (const callSite of findCallSites(sourceText, "createQueryValidator")) {
      const lineNumber = resolveLineNumberFromIndex(sourceText, callSite.index);
      const argsText = String(callSite.argsText || "").trim();
      if (!argsText.startsWith("{") || !/\binvalidValues\s*:/u.test(argsText)) {
        issues.push(
          `${relativePath}:${lineNumber}: [filters:validator-mode] createQueryValidator(...) must be written explicitly as createQueryValidator({ invalidValues: "reject" | "discard" }). Do not rely on hidden defaults, aliases, or indirect option objects.`
        );
      }
    }
  }

  async function collectMdiSvgDoctorIssues({ appRoot, issues }) {
    if (!(await appUsesVuetifyMdiSvg(appRoot))) {
      return;
    }

    const vueFilePaths = [];
    for (const relativeRoot of APP_SOURCE_SCAN_ROOTS) {
      await collectAppSourceFiles(
        path.join(appRoot, relativeRoot),
        { extensions: VUE_SOURCE_EXTENSIONS },
        vueFilePaths
      );
    }

    vueFilePaths.sort((left, right) => left.localeCompare(right));

    for (const absolutePath of vueFilePaths) {
      const sourceText = await readFile(absolutePath, "utf8");
      collectDirectMdiSvgTemplateIconIssues({
        sourceText,
        relativePath: normalizeRelativePath(appRoot, absolutePath),
        issues
      });
    }
  }

  async function collectCrudFilterDoctorIssues({ appRoot, issues }) {
    const sourceFilePaths = [];
    for (const relativeRoot of APP_SOURCE_SCAN_ROOTS) {
      await collectAppSourceFiles(path.join(appRoot, relativeRoot), undefined, sourceFilePaths);
    }

    sourceFilePaths.sort((left, right) => left.localeCompare(right));

    for (const absolutePath of sourceFilePaths) {
      const sourceText = await readFile(absolutePath, "utf8");
      if (
        !sourceText.includes("useCrudListFilters") &&
        !sourceText.includes("createCrudListFilters") &&
        !sourceText.includes("createQueryValidator")
      ) {
        continue;
      }

      const relativePath = normalizeRelativePath(appRoot, absolutePath);
      collectFilterDefinitionOwnershipIssues({
        sourceText,
        relativePath,
        issues
      });
      collectFilterValidatorModeIssues({
        sourceText,
        relativePath,
        issues
      });
    }
  }

  async function collectUiVerificationDoctorIssues({ appRoot, issues }) {
    if (!(await directoryLooksLikeJskitAppRoot(appRoot))) {
      return;
    }

    const changedUiState = resolveChangedUiFilesFromGit(appRoot);
    if (!changedUiState.available || changedUiState.paths.length < 1) {
      return;
    }

    const receiptPath = path.join(appRoot, UI_VERIFICATION_RECEIPT_RELATIVE_PATH);
    if (!(await fileExists(receiptPath))) {
      issues.push(
        `[ui:verification] changed UI files require a matching ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} receipt. Run jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>. Current files: ${changedUiState.paths.join(", ")}`
      );
      return;
    }

    let parsedReceipt = null;
    try {
      parsedReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    } catch (error) {
      issues.push(
        `[ui:verification] ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    const receipt = normalizeUiVerificationReceipt(parsedReceipt);
    if (!isValidUiVerificationReceipt(receipt)) {
      issues.push(
        `[ui:verification] ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} is incomplete. It must include version, runner, recordedAt, feature, command, authMode, and changedUiFiles from jskit app verify-ui.`
      );
      return;
    }

    if (JSON.stringify(receipt.changedUiFiles) !== JSON.stringify(changedUiState.paths)) {
      issues.push(
        `[ui:verification] ${UI_VERIFICATION_RECEIPT_RELATIVE_PATH} does not match the current changed UI file set. Re-run jskit app verify-ui after the latest UI edits. Current files: ${changedUiState.paths.join(", ")}`
      );
    }
  }

  function collectDiLabelParityIssuesForPackage({ packageEntry, packageInsights }) {
    const packageId = String(packageEntry?.packageId || "").trim();
    const descriptor = ensureObject(packageEntry?.descriptor);
    const metadataApiSummary = ensureObject(ensureObject(descriptor.metadata).apiSummary);
    const descriptorTokenSummary = ensureObject(metadataApiSummary.containerTokens);
    const bindingSections = ensureObject(ensureObject(packageInsights).containerBindings);
    const issues = [];
    const sides = ["server", "client"];

    collectProviderIntrospectionIssues({ packageId, packageInsights, issues });

    for (const side of sides) {
      const declaredTokens = collectDescriptorContainerTokens({
        packageId,
        side,
        values: descriptorTokenSummary[side],
        issues
      });
      const usedTokens = collectUsedContainerTokens({
        packageId,
        side,
        bindings: bindingSections[side],
        issues
      });

      for (const token of sortStrings([...usedTokens])) {
        if (!declaredTokens.has(token)) {
          issues.push({
            packageId,
            side,
            code: "binding-token-undeclared",
            token,
            message: `${packageId} (${side}): token is used by providers but missing from metadata.apiSummary.containerTokens.${side}: ${token}.`
          });
        }
      }
      for (const token of sortStrings([...declaredTokens])) {
        if (!usedTokens.has(token)) {
          issues.push({
            packageId,
            side,
            code: "descriptor-token-unused",
            token,
            message: `${packageId} (${side}): token is declared in metadata.apiSummary.containerTokens.${side} but never bound by providers: ${token}.`
          });
        }
      }
    }

    return issues;
  }

  async function commandDoctor({ cwd, options, stdout }) {
    const appRoot = await resolveAppRootFromCwd(cwd);
    const { lock } = await loadLockFile(appRoot);
    const packageRegistry = await loadPackageRegistry();
    const appLocalRegistry = await loadAppLocalPackageRegistry(appRoot);
    const combinedPackageRegistry = mergePackageRegistries(packageRegistry, appLocalRegistry);
    const issues = [];
    const installed = ensureObject(lock.installedPackages);
    await hydratePackageRegistryFromInstalledNodeModules({
      appRoot,
      packageRegistry: combinedPackageRegistry,
      seedPackageIds: Object.keys(installed)
    });

    for (const [packageId, lockEntryValue] of Object.entries(installed)) {
      const lockEntry = ensureObject(lockEntryValue);
      if (!combinedPackageRegistry.has(packageId)) {
        issues.push(`Installed package not found in package registry: ${packageId}`);
        continue;
      }

      const managed = ensureObject(lockEntry.managed);
      for (const fileChange of ensureArray(managed.files)) {
        const changeRecord = ensureObject(fileChange);
        const relativePath = String(changeRecord.path || "").trim();
        const absolutePath = path.join(appRoot, relativePath);
        if (!(await fileExists(absolutePath))) {
          issues.push(`${packageId}: managed file missing: ${relativePath}`);
        }
      }
    }

    await collectMdiSvgDoctorIssues({
      appRoot,
      issues
    });
    await collectCrudFilterDoctorIssues({
      appRoot,
      issues
    });
    await collectUiVerificationDoctorIssues({
      appRoot,
      issues
    });

    const payload = {
      appRoot,
      lockVersion: lock.lockVersion,
      installedPackages: sortStrings(Object.keys(installed)),
      issues
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stdout.write(`App root: ${appRoot}\n`);
      stdout.write(`Installed packages: ${payload.installedPackages.length}\n`);
      if (issues.length === 0) {
        stdout.write("Doctor status: healthy\n");
      } else {
        stdout.write(`Doctor status: unhealthy (${issues.length} issue(s))\n`);
        for (const issue of issues) {
          stdout.write(`- ${issue}\n`);
        }
      }
    }

    return issues.length === 0 ? 0 : 1;
  }

  async function commandLintDescriptors({ options, stdout }) {
    const packageRegistry = await loadPackageRegistry();
    const bundleRegistry = await loadBundleRegistry();
    const shouldCheckDiLabels = options.checkDiLabels === true;
    let diLabelIssues = [];
    if (shouldCheckDiLabels) {
      const issues = [];
      for (const packageId of sortStrings([...packageRegistry.keys()])) {
        const packageEntry = packageRegistry.get(packageId);
        if (!packageEntry) {
          continue;
        }
        const packageInsights = await inspectPackageOfferings({ packageEntry });
        issues.push(...collectDiLabelParityIssuesForPackage({ packageEntry, packageInsights }));
      }
      diLabelIssues = issues;
    }
    const payload = {
      packageCount: packageRegistry.size,
      bundleCount: bundleRegistry.size,
      packages: sortStrings([...packageRegistry.keys()]),
      bundles: sortStrings([...bundleRegistry.keys()]),
      diLabelCheck: shouldCheckDiLabels
        ? {
            enabled: true,
            issueCount: diLabelIssues.length,
            issues: diLabelIssues
          }
        : {
            enabled: false
          }
    };

    if (options.json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      const descriptorStatus = shouldCheckDiLabels && diLabelIssues.length > 0 ? "failed" : "passed";
      stdout.write(`Descriptor lint ${descriptorStatus}.\n`);
      stdout.write(`Packages: ${payload.packageCount}\n`);
      stdout.write(`Bundles: ${payload.bundleCount}\n`);
      if (shouldCheckDiLabels) {
        if (diLabelIssues.length === 0) {
          stdout.write("DI label parity check passed.\n");
        } else {
          stdout.write(`DI label parity check failed (${diLabelIssues.length} issue(s)).\n`);
          for (const issue of diLabelIssues) {
            const code = String(issue?.code || "").trim();
            const codeLabel = code ? `[${code}] ` : "";
            stdout.write(`- ${codeLabel}${String(issue?.message || "").trim()}\n`);
          }
        }
      }
    }
    if (shouldCheckDiLabels && diLabelIssues.length > 0) {
      return 1;
    }
    return 0;
  }

  return {
    commandDoctor,
    commandLintDescriptors
  };
}

export { createHealthCommands };
