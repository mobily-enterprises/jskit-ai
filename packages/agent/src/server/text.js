// Reading and measuring text.

/**
 * A rough token count (about four characters a token; a picture counts as a thousand), enough to
 * decide when to summarise and where to cut.
 */
export function estimateTokens(messages) {
  let tokens = 0;
  for (const message of messages) {
    if (typeof message.content === "string") tokens += Math.ceil(message.content.length / 4);
    else for (const part of message.content || []) tokens += part.type === "image" ? 1000 : Math.ceil(JSON.stringify(part).length / 4);
  }
  return tokens;
}

// How much of a long text is shown at once (about 30,000 tokens).
export const READ_LIMIT = 120000;

/**
 * A long text in parts, whole lines at a time (as Claude Code's reader does). A line longer than
 * half a part (minified JSON, a progress bar) is split, so reading always moves on.
 */
export function textPart(text, fromLine = 1) {
  const pieces = String(text).split("\n").flatMap((line) => (line.length <= READ_LIMIT / 2 ? [line] : Array.from({ length: Math.ceil(line.length / (READ_LIMIT / 2)) }, (_, index) => line.slice(index * (READ_LIMIT / 2), (index + 1) * (READ_LIMIT / 2)))));
  const part = [];
  let size = 0;
  for (let index = fromLine - 1; index < pieces.length && size + pieces[index].length < READ_LIMIT; index += 1) {
    part.push(pieces[index]);
    size += pieces[index].length + 1;
  }
  const next = fromLine + part.length;
  const more = next <= pieces.length ? `\n… (lines ${fromLine}–${next - 1} of ${pieces.length}; read on with from_line: ${next})` : "";
  return { lines: pieces.length, shown: `${part.join("\n")}${more}` };
}

/** Whether two passages say much the same: most of the shorter one's longer words are in the other. */
export function sameGist(a, b) {
  const words = (text) => new Set(String(text).toLowerCase().match(/[\p{L}\p{N}'-]{4,}/gu) || []);
  const [one, two] = [words(a), words(b)];
  const smaller = Math.min(one.size, two.size);
  if (smaller < 6) return false;
  return [...one].filter((word) => two.has(word)).length / smaller >= 0.6;
}

/** Lines that are only a bracketed note are bookkeeping, never something to show the person. */
export function stripNotes(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !/^\s*(?:\([^()]*\)\s*)+$/u.test(line))
    .join("\n")
    .trim();
}
