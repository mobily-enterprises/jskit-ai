import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commandTools, createCommands, gvisorExecutor, localExecutor } from "../src/server/index.js";
import { DATABASE, testDatabase } from "./database.js";

const gvisor = gvisorExecutor();
const executors = [["local", localExecutor(), false], ["gVisor", gvisor, gvisor.available() ? false : "gVisor's runsc isn't installed (AGENT_RUNSC)"]];

for (const [name, executor, unavailable] of executors) {
  test(`commands run in the workspace (${name}): output cut and read whole, background, the server's environment kept out`, { skip: DATABASE || unavailable }, async (context) => {
    const knex = await testDatabase(context);
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-commands-"));
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "agent-outputs-"));
    const ended = [];
    const commands = createCommands({ knex, executor, outputDir, onEnd: (row) => ended.push(row.id), limits: { ...createCommands({ knex, executor }).limits, foregroundSeconds: 3, outputHead: 100, outputTail: 100 } });
    const tools = commandTools({ commands, conversationId: 1, root });

    process.env.AGENT_TEST_SECRET = "hidden";
    const made = await tools.runCommand.execute({ why: "Making a file", script: "echo made > made.txt; echo \"secret=${AGENT_TEST_SECRET:-none}\"; pwd" });
    assert.equal(made.status, "done");
    assert.equal(made.exitCode, 0);
    assert.match(made.output, /secret=none/u, "no server variable reaches a command");
    assert.match(made.output, new RegExp(root.replace(/[/.]/gu, "\\$&"), "u"), "it runs in the workspace, at the same path");
    assert.equal(await readFile(path.join(root, "made.txt"), "utf8"), "made\n");

    const long = await tools.runCommand.execute({ why: "Counting", script: "seq 1 2000" });
    assert.equal(long.truncated, true);
    assert.match(long.output, /characters cut/u);
    const whole = await tools.readCommandOutput.execute({ run: long.run });
    assert.equal(whole.lines, 2001);
    assert.match(whole.output, /^1\n2\n/u);
    assert.match(whole.output, /\n2000(\n|$)/u);
    const fromFile = await tools.runCommand.execute({ why: "Reading the log", script: `tail -1 ${outputDir}/1/${long.run}.log` });
    assert.match(fromFile.output, /^2000/u, "the next command can read the whole output too");

    const failing = await tools.runCommand.execute({ why: "Failing", script: "echo oops >&2; exit 3" });
    assert.equal(failing.status, "failed");
    assert.equal(failing.exitCode, 3);
    assert.match(failing.output, /oops/u);

    const slow = await tools.runCommand.execute({ why: "Waiting", script: "sleep 5; echo finally" });
    assert.equal(slow.status, "running", "past the foreground time it carries on in the background");
    assert.equal((await tools.checkCommand.execute({ run: slow.run })).status, "running");
    for (let tries = 0; tries < 40 && !ended.includes(slow.run) && !ended.map(String).includes(slow.run); tries += 1) await new Promise((resolve) => setTimeout(resolve, 250));
    const checked = await tools.checkCommand.execute({ run: slow.run });
    assert.equal(checked.status, "done");
    assert.match(checked.output, /finally/u);

    const timed = await tools.runCommand.execute({ why: "Too slow", script: "sleep 30", seconds: 5 });
    const timedOut = timed.status === "running" ? await new Promise((resolve) => setTimeout(async () => resolve(await tools.checkCommand.execute({ run: timed.run })), 4000)) : timed;
    assert.equal(timedOut.status, "timed_out");

    assert.match((await commandTools({ commands, conversationId: 2, root }).checkCommand.execute({ run: made.run })).error, /no such command/u, "another conversation's commands can't be seen");
  });
}

test("a running command whose server stopped is reported stopped", { skip: DATABASE }, async (context) => {
  const knex = await testDatabase(context);
  const commands = createCommands({ knex, executor: localExecutor() });
  const [row] = await knex("agent_commands").insert({ conversation_id: 1, script: "sleep 100", status: "running", server: "gone:1", heartbeat_at: knex.raw("now() - interval '5 minutes'") }).returning("id");
  const checked = await commands.check(1, String(row.id));
  assert.equal(checked.status, "stopped");
  assert.match(checked.output, /server running it stopped/u);
});
