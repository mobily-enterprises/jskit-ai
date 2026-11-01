import path from "node:path";

// What a package map lists for each source file: its exported symbols (with
// signatures, and `type <Name>` for each JSDoc @typedef) and its local
// functions, read from the text with patterns rather than a parser.

function normalizeSignatureParams(rawParams = "") {
  return String(rawParams || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pushUnique(items, item) {
  if (!items.includes(item)) {
    items.push(item);
  }
}

function createDeclarationPattern(sourcePattern) {
  return new RegExp(`^${sourcePattern}`, "gm");
}

function extractVueScriptText(sourceText = "") {
  const scriptBlocks = [];
  const scriptBlockPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of sourceText.matchAll(scriptBlockPattern)) {
    const scriptContent = String(match[1] || "").trim();
    if (scriptContent) {
      scriptBlocks.push(scriptContent);
    }
  }

  return scriptBlocks.join("\n\n");
}

function normalizeSourceText(filePath, sourceText) {
  if (path.extname(filePath) === ".vue") {
    return extractVueScriptText(sourceText);
  }
  return sourceText;
}

function collectTopLevelDeclarations(sourceText) {
  const declarations = [];
  const addDeclaration = (kind, name, params, index) => {
    if (!name) {
      return;
    }
    declarations.push({
      index,
      kind,
      name,
      signature: kind === "class"
        ? `${name}`
        : `${name}(${normalizeSignatureParams(params)})`
    });
  };

  const patterns = [
    {
      kind: "function",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*\{`)
    },
    {
      kind: "function",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([\s\S]*?)\)\s*=>`)
    },
    {
      kind: "function",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>`)
    },
    {
      kind: "function",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(([\s\S]*?)\)\s*\{`)
    },
    {
      kind: "class",
      pattern: createDeclarationPattern(String.raw`(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b`)
    }
  ];

  for (const { kind, pattern } of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      const [, name = "", params = ""] = match;
      addDeclaration(kind, name, params, match.index ?? 0);
    }
  }

  declarations.sort((left, right) => left.index - right.index);

  const declarationByName = new Map();
  for (const declaration of declarations) {
    if (!declarationByName.has(declaration.name)) {
      declarationByName.set(declaration.name, declaration);
    }
  }

  return declarationByName;
}

function parseExportSpecifierBlock(specifierBlock = "") {
  const results = [];
  const fragments = String(specifierBlock || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const fragment of fragments) {
    const parts = fragment.split(/\s+as\s+/i).map((entry) => entry.trim()).filter(Boolean);
    const exportedName = parts[1] || parts[0] || "";
    if (exportedName) {
      pushUnique(results, exportedName);
    }
  }

  return results;
}

// The index just past the `}` that closes the JSDoc type opening at `index`.
function skipJsdocType(commentText, index) {
  let depth = 0;
  for (let cursor = index; cursor < commentText.length; cursor += 1) {
    if (commentText[cursor] === "{") {
      depth += 1;
    } else if (commentText[cursor] === "}" && --depth === 0) {
      return cursor + 1;
    }
  }
  return commentText.length;
}

// A module exports each type a top-level JSDoc comment declares with `@typedef`,
// such as the capability types of a `types.js`.
function collectTypedefNames(sourceText) {
  const names = [];
  for (const [commentText] of sourceText.matchAll(/^\/\*\*[\s\S]*?\*\//gmu)) {
    for (const tag of commentText.matchAll(/@typedef\b[\s*]*/gu)) {
      let nameIndex = tag.index + tag[0].length;
      if (commentText[nameIndex] === "{") {
        nameIndex = skipJsdocType(commentText, nameIndex);
      }
      const name = commentText.slice(nameIndex).match(/^[\s*]*([A-Za-z_$][\w$]*)/u)?.[1];
      if (name) {
        pushUnique(names, name);
      }
    }
  }
  return names;
}

function collectExportedSymbols(sourceText, declarationByName) {
  const exportedSymbols = [];

  const pushExport = (exportedName) => {
    if (!exportedName) {
      return;
    }
    const declaration = declarationByName.get(exportedName);
    pushUnique(exportedSymbols, declaration?.signature || exportedName);
  };

  const directPatterns = [
    createDeclarationPattern(String.raw`export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*\{`),
    createDeclarationPattern(String.raw`export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b`),
    createDeclarationPattern(String.raw`export\s+class\s+([A-Za-z_$][\w$]*)\b`)
  ];

  for (const pattern of directPatterns) {
    for (const match of sourceText.matchAll(pattern)) {
      pushExport(match[1] || "");
    }
  }

  const exportBlockPattern = /^export\s*\{([\s\S]*?)\}\s*(?:from\s+["'][^"']+["'])?\s*;?/gm;
  for (const match of sourceText.matchAll(exportBlockPattern)) {
    for (const exportedName of parseExportSpecifierBlock(match[1])) {
      pushExport(exportedName);
    }
  }

  const exportDefaultFunctionPattern = /^export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)?\s*\(([\s\S]*?)\)\s*\{/gm;
  for (const match of sourceText.matchAll(exportDefaultFunctionPattern)) {
    const exportedName = match[1] || "default";
    pushUnique(exportedSymbols, `${exportedName}(${normalizeSignatureParams(match[2])})`);
  }

  const exportDefaultClassPattern = /^export\s+default\s+class\s+([A-Za-z_$][\w$]*)?\b/gm;
  for (const match of sourceText.matchAll(exportDefaultClassPattern)) {
    pushUnique(exportedSymbols, match[1] || "default");
  }

  if (/^export\s+default\s+\{/m.test(sourceText) || /^export\s+default\s+defineComponent\s*\(/m.test(sourceText)) {
    pushUnique(exportedSymbols, "default");
  }

  for (const typedefName of collectTypedefNames(sourceText)) {
    pushUnique(exportedSymbols, `type ${typedefName}`);
  }

  return exportedSymbols;
}

function collectLocalFunctions(declarationByName, exportedSymbols) {
  const exportedNames = new Set(
    exportedSymbols.map((entry) => String(entry || "").split("(")[0])
  );
  const localFunctions = [];

  for (const declaration of declarationByName.values()) {
    if (declaration.kind !== "function") {
      continue;
    }
    if (exportedNames.has(declaration.name)) {
      continue;
    }
    pushUnique(localFunctions, declaration.signature);
  }

  return localFunctions;
}

// What a package map lists for one source file.
function describeSourceFile(filePath, rawSourceText) {
  const sourceText = normalizeSourceText(filePath, rawSourceText);
  const declarationByName = collectTopLevelDeclarations(sourceText);
  const exportedSymbols = collectExportedSymbols(sourceText, declarationByName);
  return {
    exportedSymbols,
    localFunctions: collectLocalFunctions(declarationByName, exportedSymbols)
  };
}

export { describeSourceFile };
