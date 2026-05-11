import { readFile } from "node:fs/promises";
import {
  abandonSession,
  adoptCodexThreadId,
  buildSessionErrorResponse,
  createSession,
  inspectSessionDetails,
  listSessions,
  runSessionStep
} from "../sessionRuntime.js";

function writeJson(stdout, payload) {
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeSessionText(stdout, payload) {
  if (payload.sessions) {
    stdout.write("JSKIT sessions\n");
    if (payload.sessions.length < 1) {
      stdout.write("No sessions found.\n");
      return;
    }
    for (const session of payload.sessions) {
      stdout.write(`- ${session.sessionId} ${session.status} ${session.currentStep || "done"}\n`);
    }
    return;
  }

  stdout.write(`Session: ${payload.sessionId || "unknown"}\n`);
  stdout.write(`Status: ${payload.status || "unknown"}\n`);
  stdout.write(`Current step: ${payload.currentStep || "done"}\n`);
  if (payload.issueUrl) {
    stdout.write(`Issue: ${payload.issueUrl}\n`);
  }
  if (payload.prUrl) {
    stdout.write(`PR: ${payload.prUrl}\n`);
  }
  if (payload.branch) {
    stdout.write(`Branch: ${payload.branch}\n`);
  }
  if (payload.worktree) {
    stdout.write(`Worktree: ${payload.worktree}\n`);
  }
  if (payload.completedSteps?.length) {
    stdout.write("Done steps:\n");
    for (const step of payload.completedSteps) {
      stdout.write(`- ${step}\n`);
    }
  }
  if (payload.prompt) {
    stdout.write("\n");
    stdout.write(payload.prompt);
    stdout.write("\n");
  }
  if (payload.errors?.length) {
    stdout.write("Errors:\n");
    for (const error of payload.errors) {
      stdout.write(`- [${error.code}] ${error.message}\n`);
      if (error.repairCommand) {
        stdout.write(`  Repair: ${error.repairCommand}\n`);
      }
    }
  }
  if (payload.nextCommand) {
    stdout.write(`Next: ${payload.nextCommand}\n`);
  }
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function resolveInputFilePath(cwd, filePath) {
  return filePath.startsWith("/") ? filePath : `${cwd}/${filePath}`;
}

async function resolveTextInput({
  codePrefix,
  fileOption,
  inlineOptions = {},
  io = {},
  repairCommand,
  cwd,
  stdinOption,
  textOption,
  sessionId
}) {
  if (Object.hasOwn(inlineOptions, fileOption)) {
    const inputFile = String(inlineOptions[fileOption] || "").trim();
    if (!inputFile) {
      return { ok: true, value: "" };
    }
    const resolvedInputFile = resolveInputFilePath(cwd, inputFile);
    try {
      return {
        ok: true,
        value: await readFile(resolvedInputFile, "utf8")
      };
    } catch (error) {
      return {
        ok: false,
        payload: buildSessionErrorResponse({
          targetRoot: cwd,
          sessionId,
          code: `${codePrefix}_file_read_failed`,
          message: `Could not read ${codePrefix.replaceAll("_", " ")} file ${resolvedInputFile}: ${error.message}`,
          repairCommand
        })
      };
    }
  }
  if (Object.hasOwn(inlineOptions, textOption)) {
    const textValue = String(inlineOptions[textOption] ?? "");
    if (textValue === stdinOption) {
      return {
        ok: true,
        value: await readStream(io.stdin)
      };
    }
    return {
      ok: true,
      value: textValue
    };
  }
  return { ok: true, value: "" };
}

async function resolveStepInputs({
  inlineOptions = {},
  io = {},
  cwd,
  sessionId
}) {
  const issue = await resolveTextInput({
    codePrefix: "issue",
    fileOption: "issue-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --issue -`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "issue"
  });
  if (issue.ok === false) {
    return issue;
  }

  return {
    issue: issue.value,
    ok: true
  };
}

function normalizeStepOptions(inlineOptions = {}) {
  return {
    ...inlineOptions,
    prompt: inlineOptions.prompt,
    userCheck: inlineOptions["user-check"] || inlineOptions.userCheck
  };
}

function createSessionCommands() {
  return {
    async commandSession({
      positional = [],
      options = {},
      cwd,
      stdout,
      io = {}
    } = {}) {
      const [first, second] = positional;
      const inlineOptions = options.inlineOptions || {};
      let payload;

      if (!first) {
        payload = await listSessions({ targetRoot: cwd });
      } else if (first === "create") {
        payload = await createSession({ targetRoot: cwd });
      } else if (second === "step") {
        const stepInputs = await resolveStepInputs({
          inlineOptions,
          io,
          cwd,
          sessionId: first
        });
        payload = stepInputs.ok === false
          ? stepInputs.payload
          : await runSessionStep({
              targetRoot: cwd,
              sessionId: first,
              options: {
                ...normalizeStepOptions(inlineOptions),
                issue: stepInputs.issue
              }
            });
      } else if (second === "abandon") {
        payload = await abandonSession({
          targetRoot: cwd,
          sessionId: first
        });
      } else if (second === "adopt-codex-thread") {
        payload = await adoptCodexThreadId({
          targetRoot: cwd,
          sessionId: first,
          codexThreadId: inlineOptions["codex-thread-id"] || inlineOptions.codexThreadId
        });
      } else if (!second) {
        payload = await inspectSessionDetails({
          targetRoot: cwd,
          sessionId: first
        });
      } else {
        payload = buildSessionErrorResponse({
          targetRoot: cwd,
          sessionId: first,
          code: "unknown_session_subcommand",
          message: `Unknown session subcommand: ${second}`,
          repairCommand: `jskit session ${first}`
        });
      }

      if (options.json) {
        writeJson(stdout, payload);
      } else {
        writeSessionText(stdout, payload);
      }
      return payload.ok === false ? 1 : 0;
    }
  };
}

export { createSessionCommands };
