import { ensureArray, ensureObject } from "./collectionUtils.js";

const ANSI_RESET = "\u001b[0m";
const ANSI_BOLD = "\u001b[1m";
const ANSI_DIM = "\u001b[2m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_WHITE = "\u001b[97m";

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

export {
  createColorFormatter,
  resolveWrapWidth,
  writeWrappedItems
};
