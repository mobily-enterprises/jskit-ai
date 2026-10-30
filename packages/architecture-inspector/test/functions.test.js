import assert from "node:assert/strict";
import test from "node:test";
import { inspectCallsOf } from "./support.js";

// Shapes whose starts were checked against Genesis's ast-grep function sites
// (Decision 6: the syntax node's start, after decorators, `export` and
// comments). Each entry is id, kind, name and container.
const SOURCE = {
  "src/shapes.js": "// Leading comment\nexport function exported(a) { return a; }\nexport default function main() { return exported(1); }\nexport const arrow = (value) => value * 2;\nexport const asyncArrow = async (value) => value;\nconst expression = function named() { return 1; };\nconst anonymous = function () { return 2; };\nfunction* generator() { yield 1; }\nasync function asynchronous() { await Promise.resolve(); }\n/** Doc comment */\nclass Store {\n  constructor(items) { this.items = items; }\n  static create() { return new Store([]); }\n  async load() { return this.items; }\n  get size() { return this.items.length; }\n  set size(value) { this.items.length = value; }\n  #secret() { return 1; }\n  field = () => this.items;\n  *entries() { yield* this.items; }\n}\nconst api = {\n  list() { return []; },\n  read: (id) => id,\n  async write(value) { return value; },\n  remove: function (id) { return id; }\n};\n[1, 2].map((item) => item + 1).filter(function keep(item) { return item > 1; });\nexport { Store, api, expression, anonymous, generator, asynchronous };\n",
  "src/typed.ts": "function decorate(target: unknown, context: unknown) { return target; }\nexport class Service {\n  @decorate\n  run(): number { return 1; }\n  private helper(value: string): string { return value; }\n  public static make(): Service { return new Service(); }\n}\nexport abstract class Base { abstract go(): void; done(): void {} }\nexport const typed = <T,>(value: T): T => value;\n",
  "src/Widget.vue": "<template><button @click=\"save\">Save</button></template>\n<script>\nexport default { name: \"Widget\", methods: { legacy() { return 1; } } };\n</script>\n<script setup>\nimport { exported } from \"./shapes.js\";\nconst save = () => exported(1);\nfunction local() { return save(); }\n</script>\n",
  "src/start.js": "function startsAtOrigin() { return 1; }\nstartsAtOrigin();\n"
};

const EXPECTED = [
  ["fn:src/shapes.js#module", "module", "", undefined],
  ["fn:src/shapes.js#2:8", "function", "exported", undefined],
  ["fn:src/shapes.js#3:16", "function", "main", undefined],
  ["fn:src/shapes.js#4:22", "arrow", "arrow", undefined],
  ["fn:src/shapes.js#5:27", "arrow", "asyncArrow", undefined],
  ["fn:src/shapes.js#6:20", "closure", "named", undefined],
  ["fn:src/shapes.js#7:19", "closure", "anonymous", undefined],
  ["fn:src/shapes.js#8:1", "function", "generator", undefined],
  ["fn:src/shapes.js#9:1", "function", "asynchronous", undefined],
  ["fn:src/shapes.js#12:3", "constructor", "constructor", "Store"],
  ["fn:src/shapes.js#13:3", "method", "create", "Store"],
  ["fn:src/shapes.js#14:3", "method", "load", "Store"],
  ["fn:src/shapes.js#15:3", "method", "size", "Store"],
  ["fn:src/shapes.js#16:3", "method", "size", "Store"],
  ["fn:src/shapes.js#17:3", "method", "#secret", "Store"],
  ["fn:src/shapes.js#18:11", "arrow", "field", "Store"],
  ["fn:src/shapes.js#19:3", "method", "entries", "Store"],
  ["fn:src/shapes.js#22:3", "method", "list", "api"],
  ["fn:src/shapes.js#23:9", "arrow", "read", "api"],
  ["fn:src/shapes.js#24:3", "method", "write", "api"],
  ["fn:src/shapes.js#25:11", "closure", "remove", "api"],
  ["fn:src/shapes.js#27:12", "arrow", "", undefined],
  ["fn:src/shapes.js#27:39", "closure", "keep", undefined],
  ["fn:src/typed.ts#module", "module", "", undefined],
  ["fn:src/typed.ts#1:1", "function", "decorate", undefined],
  ["fn:src/typed.ts#4:3", "method", "run", "Service"],
  ["fn:src/typed.ts#5:3", "method", "helper", "Service"],
  ["fn:src/typed.ts#6:3", "method", "make", "Service"],
  ["fn:src/typed.ts#8:51", "method", "done", "Base"],
  ["fn:src/typed.ts#9:22", "arrow", "typed", undefined],
  ["fn:src/Widget.vue#module", "module", "", undefined],
  ["fn:src/Widget.vue#3:45", "method", "legacy", undefined],
  ["fn:src/Widget.vue#7:14", "arrow", "save", undefined],
  ["fn:src/Widget.vue#8:1", "function", "local", undefined],
  ["fn:src/start.js#module", "module", "", undefined],
  ["fn:src/start.js#1:1", "function", "startsAtOrigin", undefined]
];

test("functions start where Genesis's syntax sites start, with module code as fn:<path>#module", async (t) => {
  const { result } = await inspectCallsOf(t, SOURCE);
  const actual = new Map(result.functions.map((entry) => [entry.id, [entry.id, entry.kind, entry.name, entry.container]]));
  assert.deepEqual([...actual.values()].sort(), [...EXPECTED].sort());
  for (const entry of result.functions) {
    const [line, column] = entry.kind === "module" ? [1, 1] : entry.id.split("#")[1].split(":").map(Number);
    assert.deepEqual(entry.start, { line, column });
    assert.deepEqual(entry.evidence, [{ path: entry.file, hash: entry.evidence[0].hash, start: entry.start, end: entry.end }]);
  }
  // Module code spans the whole file, even when a function also starts at 1:1.
  assert.deepEqual(result.functions.find((entry) => entry.id === "fn:src/start.js#module").end, { line: 2, column: 18 });
  assert.equal(result.calls.find((call) => call.callee === "startsAtOrigin").fromFunctionId, "fn:src/start.js#module");
  assert.equal(result.capabilities.functions, "complete");
});

test("only exported top-level functions carry exported, always true", async (t) => {
  const { result } = await inspectCallsOf(t, SOURCE);
  const exported = result.functions.filter((entry) => "exported" in entry);
  assert.ok(exported.every((entry) => entry.exported === true));
  assert.deepEqual(exported.map((entry) => entry.name).sort(),
    ["anonymous", "arrow", "asyncArrow", "asynchronous", "exported", "generator", "main", "named", "typed"]);
});

test("function records keep the observation contract's field order", async (t) => {
  const { result } = await inspectCallsOf(t, { "src/a.js": "export function readStatus() {\n  return 1;\n}\n" });
  assert.deepEqual(Object.keys(result.functions[1]), ["id", "resolution", "file", "name", "kind", "exported", "start", "end", "evidence"]);
  assert.deepEqual(result.functions[1], {
    id: "fn:src/a.js#1:8",
    resolution: "resolved",
    file: "src/a.js",
    name: "readStatus",
    kind: "function",
    start: { line: 1, column: 8 },
    end: { line: 3, column: 2 },
    evidence: [{ path: "src/a.js", hash: result.inputs[0].hash, start: { line: 1, column: 8 }, end: { line: 3, column: 2 } }],
    exported: true
  });
});
