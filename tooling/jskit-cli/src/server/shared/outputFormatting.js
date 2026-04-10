import { ensureArray, ensureObject } from "./collectionUtils.js";

const ANSI_RESET = "\u001b[0m";
const ANSI_BOLD = "\u001b[1m";
const ANSI_DIM = "\u001b[2m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_WHITE = "\u001b[97m";
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b\[[0-9;]*m`, "gu");

function createColorFormatter(stream) {
  const noColor = Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR");
  const term = String(process.env.TERM || "").toLowerCase();
  const forceColor = String(process.env.FORCE_COLOR || "").trim();
  const enableColor = (() => {
    if (forceColor === "0") {
      return false;
    }
    if (forceColor) {
      return true;
    }
    if (noColor || term === "dumb") {
      return false;
    }
    return Boolean(stream && stream.isTTY);
  })();

  const paint = (text, sequence) => {
    const value = String(text);
    if (!enableColor) {
      return value;
    }
    return `${sequence}${value}${ANSI_RESET}`;
  };

  return Object.freeze({
    heading: (text) => paint(text, `${ANSI_BOLD}${ANSI_WHITE}`),
    emphasis: (text) => paint(text, `${ANSI_BOLD}${ANSI_CYAN}`),
    white: (text) => paint(text, ANSI_WHITE),
    item: (text) => paint(text, ANSI_CYAN),
    version: (text) => paint(text, ANSI_DIM),
    installed: (text) => paint(text, ANSI_GREEN),
    provider: (text) => paint(text, ANSI_YELLOW),
    dim: (text) => paint(text, ANSI_DIM)
  });
}

function resolveWrapWidth(stream, fallbackWidth = 80) {
  const parsedFallback = Number(fallbackWidth);
  const fallback = Number.isFinite(parsedFallback) ? Math.max(20, Math.floor(parsedFallback)) : 80;
  const columns = Number(stream?.columns);
  if (!Number.isFinite(columns) || columns < 20) {
    return fallback;
  }
  return Math.floor(columns);
}

function measureVisibleLength(text = "") {
  return String(text || "").replace(ANSI_ESCAPE_PATTERN, "").length;
}

function resolveLeadingWhitespace(text = "") {
  const match = String(text || "").match(/^\s*/u);
  return match?.[0] || "";
}

function buildContinuationIndent({ prefix = "", fallbackPrefix = "" } = {}) {
  const prefixLength = measureVisibleLength(prefix);
  const fallbackLength = measureVisibleLength(fallbackPrefix);
  const continuationLength = prefixLength > fallbackLength + 24
    ? fallbackLength
    : prefixLength;
  return " ".repeat(Math.max(0, continuationLength));
}

function resolveWrapPrefixes(line = "") {
  const normalizedLine = String(line || "").replace(/[ \t]+$/u, "");
  const prefixedPatterns = [
    {
      pattern: /^(\s+\S+)(\s{2,})(\S.*)$/u,
      create(match) {
        const prefix = `${match[1]}${match[2]}`;
        return Object.freeze({
          prefix,
          continuationPrefix: buildContinuationIndent({
            prefix,
            fallbackPrefix: resolveLeadingWhitespace(match[1])
          }),
          text: match[3]
        });
      }
    },
    {
      pattern: /^(\s*[-*]\s+)(.+)$/u,
      create(match) {
        return Object.freeze({
          prefix: match[1],
          continuationPrefix: buildContinuationIndent({
            prefix: match[1],
            fallbackPrefix: resolveLeadingWhitespace(match[1])
          }),
          text: match[2]
        });
      }
    },
    {
      pattern: /^(\s*\d+[.)]\s+)(.+)$/u,
      create(match) {
        return Object.freeze({
          prefix: match[1],
          continuationPrefix: buildContinuationIndent({
            prefix: match[1],
            fallbackPrefix: resolveLeadingWhitespace(match[1])
          }),
          text: match[2]
        });
      }
    },
    {
      pattern: /^(\s*[A-Za-z][A-Za-z0-9 ()/_-]*:\s+)(.+)$/u,
      create(match) {
        return Object.freeze({
          prefix: match[1],
          continuationPrefix: buildContinuationIndent({
            prefix: match[1],
            fallbackPrefix: resolveLeadingWhitespace(match[1])
          }),
          text: match[2]
        });
      }
    }
  ];

  for (const entry of prefixedPatterns) {
    const pattern = entry.pattern;
    const match = normalizedLine.match(pattern);
    if (!match) {
      continue;
    }
    return entry.create(match);
  }

  const leadingWhitespaceMatch = normalizedLine.match(/^(\s*)(.*)$/u);
  const prefix = leadingWhitespaceMatch?.[1] || "";
  const text = leadingWhitespaceMatch?.[2] || "";
  return Object.freeze({
    prefix,
    continuationPrefix: prefix,
    text
  });
}

function wrapOutputLine(line = "", { wrapWidth = 80 } = {}) {
  const normalizedLine = String(line || "").replace(/[ \t]+$/u, "");
  if (!normalizedLine.trim()) {
    return [""];
  }

  const width = Math.max(20, Number(wrapWidth) || 80);
  const { prefix, continuationPrefix, text } = resolveWrapPrefixes(normalizedLine);
  const words = String(text || "").trim().split(/\s+/u).filter(Boolean);
  if (words.length < 1) {
    return [normalizedLine];
  }

  const lines = [];
  let currentPrefix = prefix;
  let currentLine = currentPrefix;
  let currentLength = measureVisibleLength(currentPrefix);

  for (const word of words) {
    const separator = currentLength > measureVisibleLength(currentPrefix) ? " " : "";
    const nextLength = currentLength + measureVisibleLength(separator) + measureVisibleLength(word);
    if (currentLength > measureVisibleLength(currentPrefix) && nextLength > width) {
      lines.push(currentLine);
      currentPrefix = continuationPrefix;
      currentLine = `${currentPrefix}${word}`;
      currentLength = measureVisibleLength(currentPrefix) + measureVisibleLength(word);
      continue;
    }

    currentLine = `${currentLine}${separator}${word}`;
    currentLength = nextLength;
  }

  lines.push(currentLine);
  return lines;
}

function writeWrappedLines({ stdout, lines, wrapWidth } = {}) {
  const output = stdout || process.stdout;
  const width = resolveWrapWidth(output, wrapWidth ?? 100);
  for (const line of ensureArray(lines)) {
    for (const wrappedLine of wrapOutputLine(line, { wrapWidth: width })) {
      output.write(`${wrappedLine}\n`);
    }
  }
}

function writeWrappedItems({ stdout, heading, items, lineIndent = "  ", wrapWidth = 80 }) {
  const records = ensureArray(items)
    .map((entry) => {
      const normalized = ensureObject(entry);
      const text = String(normalized.text || "").trim();
      const rendered = String(normalized.rendered || text);
      if (!text) {
        return null;
      }
      return { text, rendered };
    })
    .filter(Boolean);

  if (records.length === 0) {
    return;
  }

  stdout.write(`${heading}\n`);
  const width = Math.max(20, Number(wrapWidth) || 80);
  let line = lineIndent;
  let lineLength = lineIndent.length;

  for (const record of records) {
    const separator = lineLength > lineIndent.length ? " " : "";
    const addedLength = separator.length + record.text.length;
    if (lineLength > lineIndent.length && lineLength + addedLength > width) {
      stdout.write(`${line}\n`);
      line = `${lineIndent}${record.rendered}`;
      lineLength = lineIndent.length + record.text.length;
      continue;
    }

    line = `${line}${separator}${record.rendered}`;
    lineLength += addedLength;
  }

  if (lineLength > lineIndent.length) {
    stdout.write(`${line}\n`);
  }
}

function renderInlineCodeSpans(text = "", color = null) {
  const sourceText = String(text || "");
  if (!sourceText.includes("`")) {
    return sourceText;
  }

  return sourceText.replace(/`([^`]+)`/g, (_match, codeText) => {
    const normalizedCodeText = String(codeText || "");
    if (!normalizedCodeText) {
      return "``";
    }
    if (!color || typeof color.item !== "function") {
      return `\`${normalizedCodeText}\``;
    }
    const rendered = String(color.item(normalizedCodeText));
    return rendered === normalizedCodeText ? `\`${normalizedCodeText}\`` : rendered;
  });
}

export {
  createColorFormatter,
  renderInlineCodeSpans,
  resolveWrapWidth,
  writeWrappedLines,
  writeWrappedItems
};
