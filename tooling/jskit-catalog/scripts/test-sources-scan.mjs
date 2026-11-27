// What test/fixed-sleep needs to know about a wait that its line cannot show: whether it is an element of
// `Promise.race([...])`, a bound on another wait, and whether a loop around it in its own function re-reads a
// condition, a poll interval. A tokenizer (strings, template literals, comments, regular expressions) and bracket
// matching, no syntax tree: a source whose brackets do not match scans to null, and the rule reads its lines alone.

const CLOSERS = new Map([[")", "("], ["]", "["], ["}", "{"]]);
const TOKEN = /=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\+\+|--|\+=|-=|\?\.|\.\.\.|[\w$]+|\S/uy;
// A `/` after a value divides; after anything else, or one of these words, it starts a regular expression.
const VALUE = /^(?:[\w$]+|[)\]}]|\+\+|--)$/u;
const BEFORE_EXPRESSION = /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|await|yield)$/u;
const COMPARISON = /^(?:<|<=|>|>=|!=|!==)$/u;
const NOT_A_COUNT = /^(?:&&|\|\||\?\?|!|\?|===|==|\(|"|'|`)$/u;
const STEP = /^(?:\+\+|--|\+=|-=)$/u;

/** Tokens from `at` to the end, or from a template's `${` to its `}`; null when a string, comment or regex never ends. */
function tokenize(text, at = 0, inTemplate = false) {
  const tokens = [];
  for (let depth = 0; at < text.length;) {
    const start = at;
    const char = text[at];
    const previous = tokens.at(-1);
    if (/\s/u.test(char)) at += 1;
    else if (text.startsWith("//", at)) at = text.includes("\n", at) ? text.indexOf("\n", at) : text.length;
    else if (text.startsWith("/*", at)) at = text.includes("*/", at + 2) ? text.indexOf("*/", at + 2) + 2 : -1;
    else if ("\"'`".includes(char) || (char === "/" && (!previous ||
      (!previous.quoted && (BEFORE_EXPRESSION.test(previous.value) || !VALUE.test(previous.value)))))) {
      at = char === "`" ? skipTemplate(text, at + 1) : skipQuoted(text, at + 1, char);
      while (char === "/" && at > 0 && /[a-z]/u.test(text[at] ?? "")) at += 1;
      tokens.push({ value: char, quoted: char, start, end: at });
    } else if (inTemplate && char === "}" && depth === 0) {
      return { tokens, end: at + 1 };
    } else {
      depth += char === "{" ? 1 : char === "}" ? -1 : 0;
      TOKEN.lastIndex = at;
      at += TOKEN.exec(text)[0].length;
      tokens.push({ value: text.slice(start, at), start, end: at });
    }
    if (at < 0) return null;
  }
  return inTemplate ? null : { tokens, end: at };
}

/** The end of a string or regular expression whose opening `quote` came just before `at`, or -1. */
function skipQuoted(text, at, quote) {
  for (let inClass = false; at < text.length && text[at] !== "\n"; at += text[at] === "\\" ? 2 : 1) {
    if (text[at] === quote && !inClass) return at + 1;
    if (quote === "/" && "[]".includes(text[at])) inClass = text[at] === "[";
  }
  return -1;
}

function skipTemplate(text, at) {
  while (at < text.length && text[at] !== "`") {
    at = text.startsWith("${", at) ? tokenize(text, at + 2, true)?.end ?? Infinity : at + (text[at] === "\\" ? 2 : 1);
  }
  return at < text.length ? at + 1 : -1;
}

/** The source's tokens, each with `parent`, its innermost open bracket, and each bracket with its `partner`; or null. */
function scanSource(text) {
  const tokens = tokenize(String(text))?.tokens;
  const open = [];
  for (const [index, token] of (tokens || []).entries()) {
    token.parent = open.at(-1) ?? -1;
    if (token.quoted) continue;
    if ("([{".includes(token.value)) {
      open.push(index);
    } else if (CLOSERS.has(token.value)) {
      if (tokens[open.at(-1)]?.value !== CLOSERS.get(token.value)) return null;
      token.partner = open.pop();
      tokens[token.partner].partner = index;
    }
  }
  return tokens && open.length < 1 ? tokens : null;
}

const precededBy = (tokens, index, ...values) => values.every((value, back) => tokens[index - 1 - back]?.value === value);

/** The `for` or `while` keyword whose header closes at `close`, or -1. */
function loopKeyword(tokens, close) {
  const open = tokens[close]?.value === ")" ? tokens[close].partner : -1;
  if (precededBy(tokens, open, "for") || precededBy(tokens, open, "while")) return open - 1;
  return precededBy(tokens, open, "await", "for") ? open - 2 : -1;
}

/** What the `{` at `open` starts: a function, a loop (with its keyword's index), a switch, or another block. */
function blockOf(tokens, open) {
  const previous = tokens[open - 1];
  if (previous?.value === "=>") return { kind: "function" };
  if (previous?.value === "do") return { kind: "loop", keyword: open - 1 };
  if (loopKeyword(tokens, open - 1) >= 0) return { kind: "loop", keyword: loopKeyword(tokens, open - 1) };
  if (previous?.value !== ")") return { kind: "block" };
  const keyword = tokens[previous.partner - 1]?.value;
  return { kind: keyword === "switch" ? "switch" : /^(?:if|catch|with)$/u.test(keyword) ? "block" : "function" };
}

/** Whether a loop (its keyword's index, its `{` or -1) reads a condition each round, or returns or breaks on one. */
function rereads(tokens, keyword, body) {
  const header = tokens[keyword].value === "do" ? tokens[body].partner + 2 : keyword + (precededBy(tokens, keyword + 2, "await") ? 2 : 1);
  const parts = [[]];
  let iterates = false;
  for (let index = header + 1; tokens[header]?.value === "(" && index < tokens[header].partner; index += 1) {
    const atTop = tokens[index].parent === header;
    iterates ||= atTop && /^(?:of|in)$/u.test(tokens[index].value);
    if (atTop && tokens[index].value === ";") parts.push([]);
    else parts.at(-1).push(tokens[index]);
  }
  const own = body >= 0 ? tokens.slice(body + 1, tokens[body].partner) : [];
  const steps = [...(parts[2] || []), ...own];
  const stepped = new Set(steps.filter((token, index) => STEP.test(steps[index + 1]?.value) || STEP.test(steps[index - 1]?.value))
    .map(({ value }) => value));
  const words = (parts.length === 3 ? parts[1] : parts[0]).map(({ value }) => value).join(" ")
    .replace(/\b(?:Date|performance) \. now \( \)/gu, "now()").split(" ").filter(Boolean);
  // A loop that only counts rounds or watches the clock waits a fixed time in all; its condition is a single
  // comparison of its own step, or the clock, with a value.
  const counts = words.length < 1 || /^(?:true|1)$/u.test(words.join(" ")) || (words.filter((word) => COMPARISON.test(word)).length === 1 &&
    !words.some((word) => NOT_A_COUNT.test(word)) && words.some((word) => word === "now()" || stepped.has(word)));
  if (!iterates && !counts) return true;
  return own.some((token, offset) => {
    const index = body + 1 + offset;
    const conditional = token.parent !== body || precededBy(tokens, index, "else") ||
      (precededBy(tokens, index, ")") && precededBy(tokens, tokens[index - 1].partner, "if"));
    return /^(?:return|break)$/u.test(token.value) && conditional && !leaves(tokens, index, body, token.value === "break");
  });
}

/** Whether a return or break at `index` leaves a function (a break also a loop or switch) nested inside `body`. */
function leaves(tokens, index, body, isBreak) {
  for (let open = tokens[index].parent; open > body; open = tokens[open].parent) {
    const { kind } = tokens[open].value === "{" ? blockOf(tokens, open) : { kind: "expression" };
    if (kind === "function" || (isBreak && (kind === "loop" || kind === "switch"))) return true;
  }
  return false;
}

/** Whether the wait whose code starts at `offset` is an element of Promise.race([...]) or polls in a loop. */
function excusedWait(text, offset, tokens = scanSource(text)) {
  const index = tokens ? tokens.findIndex((token) => token.end > offset) : -1;
  const token = tokens?.[index];
  if (!token || token.start > offset) return false;
  if (token.quoted) return "\"'`".includes(token.quoted) && excusedWait(text.slice(token.start + 1, token.end - 1), offset - token.start - 1);
  if (tokens[token.parent]?.value === "[" && precededBy(tokens, token.parent, "(", "race", ".", "Promise")) return true;
  const braceless = loopKeyword(tokens, (precededBy(tokens, index, "await") ? index - 1 : index) - 1);
  if (braceless >= 0 && rereads(tokens, braceless, -1)) return true;
  for (let open = token.parent; open >= 0; open = tokens[open].parent) {
    const block = tokens[open].value === "{" ? blockOf(tokens, open) : { kind: "expression" };
    if (block.kind === "function") return false;
    if (block.kind === "loop" && rereads(tokens, block.keyword, open)) return true;
  }
  return false;
}

export { excusedWait, scanSource };
