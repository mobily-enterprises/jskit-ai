// Small source readers for `jskit check m3`. @jskit-ai/jskit-catalog has no dependencies (apps run it through npx),
// so these read Vue, JavaScript and CSS just far enough for the Material 3 rules: blocks, tags with attributes,
// declarations, and comments blanked to spaces so every offset still maps to its original line and column.

const HEX_DIGITS = "[0-9a-fA-F]";
// #rgb, #rgba, #rrggbb and #rrggbbaa, not followed by another word character.
const HEX_COLOUR = `#(?:${HEX_DIGITS}{8}|${HEX_DIGITS}{6}|${HEX_DIGITS}{3,4})(?![\\w-])`;
const EXCEPTION_RULE = /m3-check:\s*allow\s+(\S+?)(?:-->|\*\/)?(?:\s|$)/u;
const EXCEPTION_REASON = /m3-check:\s*allow\s+\S+\s+-\s+(.*?)\s*(?:-->|\*\/)?\s*$/u;

function lineIndex(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
}

function blank(text) {
  return text.replace(/[^\n]/gu, " ");
}

// JavaScript with its comments replaced by spaces; strings and template literals are kept.
function blankJsComments(source) {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end < 0 ? source.length : end;
      output += blank(source.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end < 0 ? source.length : end + 2;
      output += blank(source.slice(index, stop));
      index = stop;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      let stop = index + 1;
      while (stop < source.length && source[stop] !== char) {
        if (source[stop] === "\\") stop += 1;
        if (char !== "`" && source[stop] === "\n") break;
        stop += 1;
      }
      output += source.slice(index, stop + 1);
      index = stop + 1;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function blankMatches(source, pattern) {
  return source.replace(pattern, (match) => blank(match));
}

const blankCssComments = (source) => blankMatches(source, /\/\*[\s\S]*?(?:\*\/|$)/gu);
const blankHtmlComments = (source) => blankMatches(source, /<!--[\s\S]*?(?:-->|$)/gu);

// Every line that mentions m3-check, read as an exception: `m3-check: allow <rule> - <reason>`. A line in any other
// form gives no rule or no reason, and the check reports it.
function readExceptions(source) {
  const exceptions = [];
  source.split("\n").forEach((text, index) => {
    if (!text.includes("m3-check:")) return;
    exceptions.push({
      line: index + 1,
      rule: EXCEPTION_RULE.exec(text)?.[1] || "",
      reason: EXCEPTION_REASON.exec(text)?.[1] || ""
    });
  });
  return exceptions;
}

function findBlocks(source, tag) {
  const blocks = [];
  const pattern = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, "giu");
  for (const match of source.matchAll(pattern)) {
    const openLength = match[0].indexOf(">") + 1;
    blocks.push({
      attributes: match[1] || "",
      offset: match.index + openLength,
      text: match[2],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return blocks;
}

// A single-file component's blocks. The template is the outermost <template>, so nested slot templates stay in it.
function splitVue(source) {
  const scripts = findBlocks(source, "script");
  const styles = findBlocks(source, "style");
  const masked = [...scripts, ...styles]
    .reduce((text, block) => text.slice(0, block.start) + blank(text.slice(block.start, block.end)) + text.slice(block.end), source);
  const open = /<template(\s[^>]*)?>/iu.exec(masked);
  const close = masked.lastIndexOf("</template");
  const template = open && close > open.index
    ? { offset: open.index + open[0].length, text: masked.slice(open.index + open[0].length, close) }
    : null;
  return { template, scripts, styles };
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
const TAG = /<([A-Za-z][\w.-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gu;

function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();
}

function readAttributes(text, offset) {
  const attributes = [];
  for (const match of text.matchAll(ATTRIBUTE)) {
    const value = match[2] ?? match[3] ?? match[4];
    const valueStart = value === undefined ? -1 : match.index + match[0].lastIndexOf(value);
    const raw = match[1];
    const bound = raw.startsWith(":") || raw.startsWith("v-bind:");
    attributes.push({
      raw,
      name: raw.replace(/^(?::|v-bind:)/u, "").toLowerCase(),
      bound,
      event: raw.startsWith("@") || raw.startsWith("v-on:"),
      value: value ?? "",
      present: true,
      offset: offset + match.index,
      valueOffset: valueStart < 0 ? offset + match.index : offset + valueStart
    });
  }
  return attributes;
}

// The tags of a template (comments already blanked), each with its attributes and, for a closed element, its
// inner source up to the first matching close tag.
function readTags(template) {
  const tags = [];
  for (const match of template.text.matchAll(TAG)) {
    const name = kebab(match[1]);
    const attributesStart = match.index + 1 + match[1].length;
    const selfClosing = match[3] === "/";
    let inner = "";
    if (!selfClosing) {
      const closePattern = new RegExp(`</${match[1]}\\s*>`, "u");
      const rest = template.text.slice(match.index + match[0].length);
      const close = closePattern.exec(rest);
      if (close) inner = rest.slice(0, close.index);
    }
    tags.push({
      name,
      offset: template.offset + match.index,
      attributes: readAttributes(match[2], template.offset + attributesStart),
      inner
    });
  }
  return tags;
}

// CSS declarations with the selectors that enclose them, for flat CSS, nested SCSS and at-rule blocks.
function readDeclarations(css, offset) {
  const declarations = [];
  const selectors = [];
  let start = 0;
  for (let index = 0; index <= css.length; index += 1) {
    const char = css[index];
    if (char !== "{" && char !== "}" && char !== ";" && index !== css.length) continue;
    const text = css.slice(start, index);
    if (char === "{") {
      selectors.push(text.trim());
    } else {
      const colon = text.indexOf(":");
      if (colon > 0 && selectors.length > 0 && text.trim()) {
        const leading = text.length - text.trimStart().length;
        declarations.push({
          property: text.slice(0, colon).trim().toLowerCase(),
          value: text.slice(colon + 1).trim(),
          selectors: [...selectors],
          offset: offset + start + leading,
          valueOffset: offset + start + colon + 1
        });
      }
      if (char === "}") selectors.pop();
    }
    start = index + 1;
  }
  return declarations;
}

// Declarations written inline, as in a style attribute.
function readInlineDeclarations(text, offset) {
  return readDeclarations(`x{${text}}`, offset - 2);
}

export {
  HEX_COLOUR,
  blankCssComments,
  blankHtmlComments,
  blankJsComments,
  kebab,
  lineIndex,
  readDeclarations,
  readExceptions,
  readInlineDeclarations,
  readTags,
  splitVue
};
