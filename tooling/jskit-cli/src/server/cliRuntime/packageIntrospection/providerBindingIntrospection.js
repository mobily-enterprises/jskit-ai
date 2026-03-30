import path from "node:path";
import { ensureObject } from "../../shared/collectionUtils.js";

function escapeRegexLiteral(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseQuotedStringLiteral(value) {
  const source = String(value || "").trim();
  if (source.length < 2) {
    return null;
  }

  const quote = source[0];
  if ((quote !== "\"" && quote !== "'") || source[source.length - 1] !== quote) {
    return null;
  }

  if (quote === "\"") {
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  }

  return source
    .slice(1, -1)
    .replace(/\\\\/g, "\\")
    .replace(/\\'/g, "'")
    .replace(/\\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function resolveLineNumberAtIndex(source, index) {
  const text = String(source || "");
  const maxIndex = Math.max(0, Math.min(Number(index) || 0, text.length));
  let line = 1;
  for (let cursor = 0; cursor < maxIndex; cursor += 1) {
    if (text[cursor] === "\n") {
      line += 1;
    }
  }
  return line;
}

function findMatchingBraceIndex(source, openBraceIndex) {
  const text = String(source || "");
  const startIndex = Number(openBraceIndex);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= text.length || text[startIndex] !== "{") {
    return -1;
  }

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let cursor = startIndex; cursor < text.length; cursor += 1) {
    const current = text[cursor];
    const next = text[cursor + 1] || "";

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        cursor += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (current === "\\") {
        cursor += 1;
        continue;
      }
      if (current === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (current === "\\") {
        cursor += 1;
        continue;
      }
      if (current === "\"") {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inTemplateQuote) {
      if (current === "\\") {
        cursor += 1;
        continue;
      }
      if (current === "`") {
        inTemplateQuote = false;
      }
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      cursor += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      cursor += 1;
      continue;
    }
    if (current === "'") {
      inSingleQuote = true;
      continue;
    }
    if (current === "\"") {
      inDoubleQuote = true;
      continue;
    }
    if (current === "`") {
      inTemplateQuote = true;
      continue;
    }

    if (current === "{") {
      depth += 1;
      continue;
    }
    if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    }
  }

  return -1;
}

function extractProviderLifecycleMethodRanges(source, providerExportName) {
  const text = String(source || "");
  const providerName = String(providerExportName || "").trim();
  if (!text) {
    return [];
  }

  const fallback = [
    {
      lifecycle: "unknown",
      start: 0,
      end: text.length
    }
  ];
  if (!providerName) {
    return fallback;
  }

  const classPattern = new RegExp(`\\bclass\\s+${escapeRegexLiteral(providerName)}\\b`);
  const classMatch = classPattern.exec(text);
  if (!classMatch) {
    return fallback;
  }

  const classOpenBraceIndex = text.indexOf("{", classMatch.index + classMatch[0].length);
  if (classOpenBraceIndex < 0) {
    return fallback;
  }
  const classCloseBraceIndex = findMatchingBraceIndex(text, classOpenBraceIndex);
  if (classCloseBraceIndex < 0) {
    return fallback;
  }

  const classBody = text.slice(classOpenBraceIndex + 1, classCloseBraceIndex);
  const methodPattern = /\b(?:async\s+)?(register|boot)\s*\([^)]*\)\s*\{/g;
  const ranges = [];
  let methodMatch = methodPattern.exec(classBody);
  while (methodMatch) {
    const lifecycle = String(methodMatch[1] || "").trim() || "unknown";
    const methodOpenOffset = methodMatch[0].lastIndexOf("{");
    if (methodOpenOffset < 0) {
      methodMatch = methodPattern.exec(classBody);
      continue;
    }
    const methodOpenIndex = classOpenBraceIndex + 1 + methodMatch.index + methodOpenOffset;
    const methodCloseIndex = findMatchingBraceIndex(text, methodOpenIndex);
    if (methodCloseIndex < 0) {
      methodMatch = methodPattern.exec(classBody);
      continue;
    }
    ranges.push({
      lifecycle,
      start: methodOpenIndex + 1,
      end: methodCloseIndex
    });
    methodMatch = methodPattern.exec(classBody);
  }

  if (ranges.length > 0) {
    return ranges;
  }
  return [
    {
      lifecycle: "class",
      start: classOpenBraceIndex + 1,
      end: classCloseBraceIndex
    }
  ];
}

function collectConstTokenAssignments(source) {
  const text = String(source || "");
  const assignments = new Map();
  const pattern = /^\s*const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;]+);\s*$/gm;
  let match = pattern.exec(text);
  while (match) {
    const identifier = String(match[1] || "").trim();
    const expression = String(match[2] || "").trim();
    if (identifier && expression) {
      assignments.set(identifier, expression);
    }
    match = pattern.exec(text);
  }
  return assignments;
}

function resolveTokenFromExpression(expression, constAssignments, visited = new Set()) {
  let normalized = String(expression || "").trim();
  if (!normalized) {
    return {
      token: "",
      resolved: false,
      kind: "empty"
    };
  }

  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }

  const quoted = parseQuotedStringLiteral(normalized);
  if (quoted !== null) {
    return {
      token: quoted,
      resolved: true,
      kind: "string"
    };
  }

  const symbolMatch = /^Symbol\.for\(\s*(['"])(.*?)\1\s*\)$/.exec(normalized);
  if (symbolMatch) {
    return {
      token: `Symbol.for(${symbolMatch[2]})`,
      resolved: true,
      kind: "symbol"
    };
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(normalized)) {
    return {
      token: normalized,
      resolved: true,
      kind: "member"
    };
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalized)) {
    const identifier = normalized;
    if (visited.has(identifier)) {
      return {
        token: identifier,
        resolved: false,
        kind: "cyclic-identifier"
      };
    }
    const nextExpression = constAssignments.get(identifier);
    if (nextExpression) {
      return resolveTokenFromExpression(nextExpression, constAssignments, new Set([...visited, identifier]));
    }
    return {
      token: identifier,
      resolved: false,
      kind: "identifier"
    };
  }

  return {
    token: normalized,
    resolved: false,
    kind: "expression"
  };
}

function collectContainerBindingsFromProviderSource({ source, providerLabel, entrypoint, providerExportName }) {
  const text = String(source || "");
  if (!text) {
    return [];
  }

  const constAssignments = collectConstTokenAssignments(text);
  const methodRanges = extractProviderLifecycleMethodRanges(text, providerExportName);
  const records = [];

  for (const range of methodRanges) {
    const lifecycle = String(range?.lifecycle || "unknown").trim() || "unknown";
    const start = Number(range?.start) || 0;
    const end = Number(range?.end) || text.length;
    const slice = text.slice(start, end);
    const bindingPattern = /\bapp\.(singleton|bind|scoped|instance)\s*\(\s*([\s\S]*?)\s*,/g;
    let match = bindingPattern.exec(slice);
    while (match) {
      const binding = String(match[1] || "").trim();
      const tokenExpression = String(match[2] || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!tokenExpression) {
        match = bindingPattern.exec(slice);
        continue;
      }
      const tokenResolution = resolveTokenFromExpression(tokenExpression, constAssignments);
      const line = resolveLineNumberAtIndex(text, start + match.index);
      records.push({
        provider: providerLabel,
        entrypoint: String(entrypoint || "").trim(),
        exportName: String(providerExportName || "").trim(),
        lifecycle,
        binding,
        token: String(tokenResolution.token || "").trim(),
        tokenExpression,
        tokenResolved: Boolean(tokenResolution.resolved),
        tokenKind: String(tokenResolution.kind || "").trim(),
        location: `${String(entrypoint || "").trim()}:${line}`,
        line
      });
      match = bindingPattern.exec(slice);
    }
  }

  return records;
}

function deriveProviderDisplayName(bindingRecord) {
  const binding = ensureObject(bindingRecord);
  const providerLabel = String(binding.provider || "").trim();
  if (!providerLabel) {
    return "";
  }

  const hashIndex = providerLabel.lastIndexOf("#");
  if (hashIndex > -1 && hashIndex < providerLabel.length - 1) {
    return providerLabel.slice(hashIndex + 1);
  }

  const entrypoint = String(binding.entrypoint || "").trim();
  if (!entrypoint) {
    return providerLabel;
  }
  const basename = path.posix.basename(entrypoint);
  return basename.replace(/\.(?:c|m)?js$/i, "") || providerLabel;
}

export {
  collectContainerBindingsFromProviderSource,
  deriveProviderDisplayName
};
