// Reading and measuring text.

// A picture costs about this many tokens whatever its size: a provider scales it down first.
const PICTURE_TOKENS = 1000;
const BINARY_PARTS = new Set(["media", "image-data", "file-data"]);

// A file's size in bytes: a Buffer or byte array, base64 text, or a data URL. A link has no
// bytes here; it counts as a picture does.
function byteSize(data) {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data?.type === "Buffer" && Array.isArray(data.data)) return data.data.length;
  if (typeof data !== "string") return null;
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(data)) return null;
  const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  return Math.floor((base64.length * 3) / 4) - (base64.match(/=*$/u)[0].length);
}

// A file's tokens: a picture's fixed cost, else about a token per four of its bytes.
function fileTokens(mediaType, data) {
  const bytes = byteSize(data);
  return String(mediaType || "").startsWith("image/") || bytes === null ? PICTURE_TOKENS : Math.ceil(bytes / 4);
}

/**
 * One message part's rough token count: text at about four characters a token, a picture a
 * thousand, and a file's bytes about four to a token. A file's bytes are never counted as the
 * JSON that writes them out, which is several characters a byte: an attachment would then count
 * as more than the whole history and push every earlier message out.
 */
export function partTokens(part) {
  if (part?.type === "image") return PICTURE_TOKENS;
  if (part?.type === "file") return fileTokens(part.mediaType, part.data);
  let binary = 0;
  // A tool result can carry pictures or files of its own, and bytes anywhere count by their size.
  const text = JSON.stringify(part, (_key, value) => {
    if (value && typeof value === "object" && BINARY_PARTS.has(value.type) && "data" in value) {
      binary += fileTokens(value.mediaType, value.data);
      return null;
    }
    const bytes = value && typeof value === "object" ? byteSize(value) : null;
    if (bytes !== null) {
      binary += Math.ceil(bytes / 4);
      return null;
    }
    return value;
  }) ?? "";
  return Math.ceil(text.length / 4) + binary;
}

/**
 * A rough token count (about four characters a token; a picture counts as a thousand, a file
 * about a token per four bytes), enough to decide when to summarise and where to cut.
 */
export function estimateTokens(messages) {
  let tokens = 0;
  for (const message of messages) {
    if (typeof message.content === "string") tokens += Math.ceil(message.content.length / 4);
    else for (const part of message.content || []) tokens += partTokens(part);
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
