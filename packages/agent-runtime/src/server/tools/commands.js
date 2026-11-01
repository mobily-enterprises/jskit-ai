import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createTool, textPart } from "@jskit-ai/agent/server";

// Commands in the workspace, through an executor (executors.js). One still running after
// `foregroundSeconds` carries on in the background on this server, with a heartbeat, and the model
// follows it with check_command; `onEnd(command)` hears when it ends. Every command is a row in the
// commands table, so check_command works from any server. Its result shows the start and the end
// of the output; all of it (up to `outputFull`) is a file, outputDir/<conversation>/<run>.log, that
// read_command_output reads in parts and the next commands can read too (as Claude Code keeps
// large outputs). Point outputDir at storage every server shares when there are several.
//
// The table has: id, conversation_id, why, script, status (running, done, failed, timed_out,
// stopped), exit_code, output, truncated, server, heartbeat_at, started_at, ended_at.
export const COMMAND_LIMITS = { foregroundSeconds: 120, maxSeconds: 1800, outputHead: 8000, outputTail: 8000, outputFull: 16 * 1024 * 1024, heartbeatSeconds: 20, staleSeconds: 90 };

export function createCommands({
  knex, executor, table = "agent_commands", outputDir = path.join(os.tmpdir(), "agent-runs"),
  onEnd = () => {}, limits = COMMAND_LIMITS, server = `${os.hostname()}:${process.pid}`
}) {
  const live = new Map();
  const logOf = (conversationId, id) => path.join(outputDir, String(conversationId), `${id}.log`);

  function view(row) {
    return {
      run: String(row.id),
      status: row.status,
      ...(row.exit_code === null || row.exit_code === undefined ? {} : { exitCode: row.exit_code }),
      output: row.output || "",
      ...(row.truncated ? { truncated: true, wholeOutput: `The output was cut. All of it is in ${logOf(row.conversation_id, row.id)} (grep, tail and sed work on it), or read it in parts with read_command_output, run ${row.id}.` } : {})
    };
  }

  async function run({ conversationId, cwd, why, script, seconds = limits.maxSeconds }) {
    if (!executor.available()) return { error: "Commands can't run on this server (its sandbox isn't installed)." };
    const [row] = await knex(table).insert({ conversation_id: conversationId, why, script, status: "running", server, heartbeat_at: knex.fn.now() }).returning("*");
    const log = logOf(conversationId, row.id);
    await mkdir(path.dirname(log), { recursive: true });
    const whole = createWriteStream(log);
    // The output as it comes: all of it to the file, and its start and end for the result.
    const shown = limits.outputHead + limits.outputTail;
    let kept = "";
    let tail = "";
    let size = 0;
    const take = (chunk) => {
      const text = chunk.toString("utf8");
      if (size < limits.outputFull) whole.write(chunk);
      size += text.length;
      if (kept.length < shown) kept += text;
      tail = (tail + text).slice(-limits.outputTail);
    };
    const child = await executor.spawn({ script, cwd, mounts: [{ source: path.dirname(log) }] });
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.min(seconds, limits.maxSeconds) * 1000);
    const beat = setInterval(() => knex(table).where({ id: row.id }).update({ heartbeat_at: knex.fn.now() }).catch(() => {}), limits.heartbeatSeconds * 1000);
    live.set(row.id, child);
    const ended = new Promise((resolve) => child.on("close", (code) => resolve(code)))
      .then(async (code) => {
        clearTimeout(timer);
        clearInterval(beat);
        live.delete(row.id);
        await new Promise((resolve) => whole.end(resolve));
        const truncated = size > shown;
        const output = truncated ? `${kept.slice(0, limits.outputHead)}\n… (${size - shown} characters cut) …\n${tail}` : kept;
        const status = timedOut ? "timed_out" : code === 0 ? "done" : "failed";
        const [done] = await knex(table).where({ id: row.id }).update({ status, exit_code: code, output, truncated, ended_at: knex.fn.now() }).returning("*");
        await Promise.resolve(onEnd(done)).catch(() => {});
        return done;
      });
    const finished = await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, limits.foregroundSeconds * 1000, null))]);
    if (finished) return view(finished);
    return { run: String(row.id), status: "running", output: kept.slice(0, limits.outputHead), note: "It's still going and carries on in the background; follow it with check_command." };
  }

  // A running command whose server stopped beating has stopped with it.
  async function check(conversationId, id) {
    if (!/^\d+$/u.test(String(id))) return { error: "Give the run number from run_command." };
    const row = await knex(table).where({ id, conversation_id: conversationId }).first();
    if (!row) return { error: "There's no such command in this conversation." };
    if (row.status === "running" && !live.has(row.id) && Date.now() - new Date(row.heartbeat_at).getTime() > limits.staleSeconds * 1000) {
      const [stopped] = await knex(table).where({ id: row.id, status: "running" }).update({ status: "stopped", output: `${row.output || ""}\n(The server running it stopped, so the command stopped too.)`, ended_at: knex.fn.now() }).returning("*");
      return view(stopped || row);
    }
    return view(row);
  }

  async function wholeOutput(conversationId, id, fromLine = 1) {
    const row = await knex(table).where({ id, conversation_id: conversationId }).first();
    if (!row) return { error: "There's no such command in this conversation." };
    if (row.status === "running") return { error: "It's still running; check_command shows its output so far." };
    if (!row.truncated) return { note: "Its output wasn't cut, so the result already showed all of it.", output: row.output };
    const whole = await readFile(logOf(conversationId, row.id), "utf8").catch(() => null);
    if (whole === null) return { error: "Its whole output isn't on this server any more." };
    const { lines, shown } = textPart(whole, fromLine);
    return { run: String(row.id), lines, output: shown };
  }

  // On shutdown: commands still running here stop, and say so.
  async function stop() {
    for (const child of live.values()) child.kill();
  }

  return { run, check, wholeOutput, stop, limits };
}

export function commandTools({ commands, conversationId, root }) {
  return {
    runCommand: createTool({
      id: "run_command",
      description: `Run a bash script in the workspace: build, test, run programs, use git and the usual Unix tools with pipes and loops. Check what you made and fix errors by running again. A command still running after ${Math.round(commands.limits.foregroundSeconds / 60)} minutes carries on in the background; follow it with check_command.`,
      inputSchema: z.object({
        why: z.string().min(3).max(160).describe("What it does, in a few plain words, e.g. Running the tests"),
        script: z.string().min(1).max(20000).describe("The bash script"),
        seconds: z.number().int().min(5).max(commands.limits.maxSeconds).optional().describe("Most it may take in total; default 30 minutes")
      }),
      execute: async ({ why, script, seconds }) => commands.run({ conversationId, cwd: root, why, script, seconds })
    }),
    checkCommand: createTool({
      id: "check_command",
      description: "See how a command that went on in the background is doing: its status and output so far.",
      inputSchema: z.object({ run: z.string().min(1).max(30) }),
      execute: async ({ run }) => commands.check(conversationId, run)
    }),
    readCommandOutput: createTool({
      id: "read_command_output",
      description: "Read the whole output of a command whose result was cut (it says so), in parts: give the run number, and from_line to carry on where the last part stopped.",
      inputSchema: z.object({ run: z.string().min(1).max(30), from_line: z.number().int().min(1).optional() }),
      execute: async ({ run, from_line: fromLine = 1 }) => (/^\d+$/u.test(run) ? commands.wholeOutput(conversationId, run, fromLine) : { error: "Give the run number from run_command or check_command." })
    })
  };
}
