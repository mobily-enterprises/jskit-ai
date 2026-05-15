import { readFile } from "node:fs/promises";
import {
  abandonSession,
  adoptCodexThreadId,
  buildSessionErrorResponse,
  createSession,
  inspectSessionDiff,
  inspectSessionDetails,
  listSessions,
  rewindSession,
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
  if (payload.gitStatus !== undefined && payload.unstagedDiff !== undefined) {
    stdout.write("\nGit status:\n");
    stdout.write(payload.gitStatus || "No changes.");
    stdout.write("\n");
    const diff = [payload.stagedDiff, payload.unstagedDiff, payload.untrackedDiff].filter(Boolean).join("\n");
    if (diff) {
      stdout.write("\nDiff:\n");
      stdout.write(diff);
      stdout.write("\n");
    }
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
  if (Object.hasOwn(inlineOptions, "blueprint") || Object.hasOwn(inlineOptions, "blueprint-file")) {
    return {
      ok: false,
      payload: buildSessionErrorResponse({
        targetRoot: cwd,
        sessionId,
        code: "session_blueprint_input_removed",
        message: "The session blueprint step no longer accepts --blueprint input. Run the step to get the Codex prompt, let Codex edit .jskit/APP_BLUEPRINT.md, then run the step again.",
        repairCommand: `jskit session ${sessionId} step`
      })
    };
  }

  const reworkNotes = await resolveTextInput({
    codePrefix: "rework_notes",
    fileOption: "rework-notes-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --user-check failed --rework-notes -`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "rework-notes"
  });
  if (reworkNotes.ok === false) {
    return reworkNotes;
  }

  const skipReason = await resolveTextInput({
    codePrefix: "skip_reason",
    fileOption: "skip-reason-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} skip --skip-reason "<reason>"`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "skip-reason"
  });
  if (skipReason.ok === false) {
    return skipReason;
  }

  const closeReason = await resolveTextInput({
    codePrefix: "close_reason",
    fileOption: "close-reason-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --skip-merge --close-reason "<reason>"`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "close-reason"
  });
  if (closeReason.ok === false) {
    return closeReason;
  }

  return {
    closeReason: closeReason.value,
    ok: true,
    reworkNotes: reworkNotes.value,
    skipReason: skipReason.value
  };
}

function normalizeStepOptions(inlineOptions = {}) {
  const options = {
    ...inlineOptions,
    closeWithoutMerge: inlineOptions["close-without-merge"] === "true" ||
      inlineOptions.closeWithoutMerge === true ||
      inlineOptions["skip-merge"] === "true" ||
      inlineOptions.skipMerge === true,
    mergePr: inlineOptions["merge-pr"] === "true" || inlineOptions.mergePr === true,
    prompt: inlineOptions.prompt,
    reviewFindings: inlineOptions["review-findings"] || inlineOptions.reviewFindings,
    resolveDeslop: inlineOptions["resolve-deslop"] === "true" || inlineOptions.resolveDeslop === true,
    skipStep: inlineOptions["skip-step"] === "true" ||
      inlineOptions.skipStep === true ||
      inlineOptions.skip === true ||
      inlineOptions.skip === "true",
    skipMainSync: inlineOptions["skip-main-sync"] === "true" || inlineOptions.skipMainSync === true,
    userCheck: inlineOptions["user-check"] || inlineOptions.userCheck
  };
  if (Object.hasOwn(inlineOptions, "review-findings-remaining") || Object.hasOwn(inlineOptions, "reviewFindingsRemaining")) {
    options.reviewFindingsRemaining = inlineOptions["review-findings-remaining"] === "true" ||
      inlineOptions.reviewFindingsRemaining === true;
  }
  return options;
}

function resolveListArchiveOption(options = {}) {
  const archives = [];
  if (options.abandoned) {
    archives.push("abandoned");
  }
  if (options.completed) {
    archives.push("completed");
  }
  if (options.all) {
    archives.push("all");
  }
  return archives.length > 0 ? archives : "active";
}

async function runSessionStepCommand({
  cwd,
  inlineOptions = {},
  io = {},
  sessionId
}) {
  const stepInputs = await resolveStepInputs({
    inlineOptions,
    io,
    cwd,
    sessionId
  });
  return stepInputs.ok === false
    ? stepInputs.payload
    : runSessionStep({
        targetRoot: cwd,
        sessionId,
        options: {
          ...normalizeStepOptions(inlineOptions),
          reworkNotes: stepInputs.reworkNotes,
          skipReason: stepInputs.skipReason,
          closeReason: stepInputs.closeReason
        }
      });
}

async function runNextSessionStep({
  cwd,
  sessionId
}) {
  const details = await inspectSessionDetails({
    targetRoot: cwd,
    sessionId
  });
  if (details.ok === false) {
    return details;
  }
  const submitOptions = details.currentStepAction?.submitOptions &&
    typeof details.currentStepAction.submitOptions === "object" &&
    !Array.isArray(details.currentStepAction.submitOptions)
    ? details.currentStepAction.submitOptions
    : {};
  return runSessionStep({
    targetRoot: cwd,
    sessionId,
    options: {
      ...submitOptions
    }
  });
}

async function runSkipSessionStep({
  cwd,
  inlineOptions = {},
  io = {},
  sessionId
}) {
  return runSessionStepCommand({
    cwd,
    inlineOptions: {
      ...inlineOptions,
      skipStep: true
    },
    io,
    sessionId
  });
}

async function runDeslopSessionStep({
  cwd,
  sessionId
}) {
  const details = await inspectSessionDetails({
    targetRoot: cwd,
    sessionId
  });
  if (details.ok === false) {
    return details;
  }
  if (details.currentStep === "review_changes_accepted") {
    const accepted = await runSessionStep({
      targetRoot: cwd,
      sessionId,
      options: {
        reviewFindingsRemaining: true
      }
    });
    if (accepted.ok === false) {
      return accepted;
    }
  } else if (details.currentStep !== "review_prompt_rendered") {
    return buildSessionErrorResponse({
      targetRoot: cwd,
      sessionId,
      code: "deslop_not_current_step",
      message: `Cannot run deslop while current step is ${details.currentStep || "done"}.`,
      repairCommand: `jskit session ${sessionId}`
    });
  }
  return runSessionStep({
    targetRoot: cwd,
    sessionId,
    options: {}
  });
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
      const [first, second, third] = positional;
      const inlineOptions = options.inlineOptions || {};
      let payload;

      if (!first) {
        payload = await listSessions({
          targetRoot: cwd,
          archive: resolveListArchiveOption(options)
        });
      } else if (first === "create" || first === "new") {
        payload = await createSession({ targetRoot: cwd });
      } else if (second === "step" || second === "run") {
        payload = await runSessionStepCommand({
          cwd,
          inlineOptions,
          io,
          sessionId: first
        });
      } else if (second === "next") {
        payload = await runNextSessionStep({
          cwd,
          sessionId: first
        });
      } else if (second === "skip") {
        payload = await runSkipSessionStep({
          cwd,
          inlineOptions,
          io,
          sessionId: first
        });
      } else if (second === "deslop") {
        payload = await runDeslopSessionStep({
          cwd,
          sessionId: first
        });
      } else if (second === "resolve-deslop") {
        payload = await runSessionStep({
          targetRoot: cwd,
          sessionId: first,
          options: {
            resolveDeslop: true
          }
        });
      } else if (second === "abandon") {
        payload = await abandonSession({
          targetRoot: cwd,
          sessionId: first
        });
      } else if (second === "diff") {
        payload = await inspectSessionDiff({
          targetRoot: cwd,
          sessionId: first
        });
      } else if (second === "rewind") {
        payload = await rewindSession({
          targetRoot: cwd,
          sessionId: first,
          stepId: inlineOptions.step || third
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
