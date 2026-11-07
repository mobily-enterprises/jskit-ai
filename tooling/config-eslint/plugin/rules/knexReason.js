import { DATA_ACCESS_GUIDE_URL, keyName, ruleMeta } from "../support.js";
import { calledMethod } from "../dataAccess.js";

// The reasons a report may leave the handle's operations for Knex, a closed list.
const KINDS = new Set(["totals", "report", "newest-per-group", "subquery", "hot-path", "runtime-tables"]);
const KNEX_LINE = /^\s*Knex:/u;
// `Knex: <kind> - <reason>`; a hot path names its ticket after the kind: `Knex: hot-path #123 - <reason>`.
const KNEX_FORM = /^\s*Knex: (\S+)( #\d+| https?:\/\/\S+)? - (\S.*?)\s*$/u;
// The JSKIT ticket that will let the resource express a hot path: #123 or the issue's URL.
const TICKET = /#\d+|https?:\/\/\S+/u;
// A repository module: invoiceRepository.js, repository.js, or any file under repositories/.
const REPOSITORY_FILE = /(?:^|[\\/])(?:[\w.-]*Repository|repository)\.[cm]?js$|(?:^|[\\/])repositories[\\/]/u;
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const HOLDERS = new Set(["Property", "MethodDefinition", "PropertyDefinition"]);
const KIND_LIST = "totals, report, newest-per-group, subquery, hot-path (with its ticket) or runtime-tables";

// A declaration as a reader sees it: with its export, when it has one.
function exported(node) {
  return node.parent?.type === "ExportNamedDeclaration" || node.parent?.type === "ExportDefaultDeclaration" ? node.parent : node;
}

// The named function around a node, as { site, name }: the node a reader sees it at (its declaration and export, the
// const that holds it, or its property or class member) and its name. A callback passed as an argument has no name of
// its own, so the function around it counts. Null outside any named function.
function namedFunction(node) {
  for (let fn = node.parent; fn; fn = fn.parent) {
    if (!FUNCTION_TYPES.has(fn.type)) {
      continue;
    }
    const holder = fn.parent;
    if (fn.type === "FunctionDeclaration" && fn.id) {
      return { site: exported(fn), name: fn.id.name };
    }
    if (holder?.type === "VariableDeclarator" && holder.init === fn && holder.id.type === "Identifier") {
      return { site: exported(holder.parent), name: holder.id.name };
    }
    if (HOLDERS.has(holder?.type) && holder.value === fn) {
      return { site: holder, name: String(keyName(holder) || "this method") };
    }
  }
  return null;
}

// The `// Knex:` lines of the comment block directly above a site: comments on consecutive lines, the last one ending
// on the line before it, so a JSDoc block may stand between the reason and the function.
function knexLines(sourceCode, site) {
  const comments = sourceCode.getCommentsBefore(site);
  const lines = [];
  let line = site.loc.start.line;
  for (let index = comments.length - 1; index >= 0 && comments[index].loc.end.line === line - 1; index -= 1) {
    line = comments[index].loc.start.line;
    if (comments[index].type === "Line" && KNEX_LINE.test(comments[index].value)) {
      lines.unshift(comments[index].value);
    }
  }
  return lines;
}

// The message id of what is wrong with a function's Knex line, or "".
function reasonProblem(lines) {
  if (lines.length < 1) {
    return "missingReason";
  }
  const match = KNEX_FORM.exec(lines[0]);
  if (!match) {
    return "reasonForm";
  }
  if (!KINDS.has(match[1])) {
    return "unknownKind";
  }
  return match[1] === "hot-path" && !match[2] && !TICKET.test(match[3]) ? "hotPathTicket" : "";
}

// A report built with Knex is one named method of the owner's repository, starting from scopedQuery(), under one line
// that says which kind of report the resource cannot express and why: `// Knex: <kind> - <reason>`.
const knexReason = Object.freeze({
  meta: ruleMeta("Require every scopedQuery() report to be a repository method under a // Knex: <kind> - <reason> line.", {
    missingReason: `{{name}} builds a report from scopedQuery() without "// Knex: <kind> - <reason>" directly above it. The kind is ${KIND_LIST}; when none fits, the resource's operations or aggregate() do the job.`,
    reasonForm: `Write {{name}}'s line as "// Knex: <kind> - <reason>" ("// Knex: hot-path #123 - <reason>" for a hot path), where the kind is ${KIND_LIST}.`,
    unknownKind: `{{name}}'s "// Knex:" line names no known kind. Use ${KIND_LIST}; when none fits, the resource's operations or aggregate() do the job.`,
    hotPathTicket: "{{name}}'s \"// Knex: hot-path\" line names no ticket. Name the JSKIT issue that will let the resource express it after the kind: \"// Knex: hot-path #123 - <reason>\", or its URL.",
    outsideMethod: "scopedQuery() is called outside a named function. Write each report as one named method of the owner's repository, under \"// Knex: <kind> - <reason>\".",
    outsideRepository: "scopedQuery() is called outside a repository module. Only the owner's repository (a *Repository.js file, or a file under repositories/) builds reports; other code calls its named methods."
  }, "layer-5-reports-the-resource-cannot-express", DATA_ACCESS_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const inRepository = REPOSITORY_FILE.test(context.filename);
    const checked = new Set();
    return {
      CallExpression(node) {
        if (calledMethod(node)?.name !== "scopedQuery") {
          return;
        }
        if (!inRepository) {
          context.report({ node, messageId: "outsideRepository" });
          return;
        }
        const method = namedFunction(node);
        if (!method) {
          context.report({ node, messageId: "outsideMethod" });
          return;
        }
        if (checked.has(method.site)) {
          return;
        }
        checked.add(method.site);
        const problem = reasonProblem(knexLines(sourceCode, method.site));
        if (problem) {
          context.report({ node, messageId: problem, data: { name: method.name } });
        }
      }
    };
  }
});

export { knexReason };
