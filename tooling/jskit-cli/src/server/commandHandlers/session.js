import { readFile } from "node:fs/promises";
import {
  abandonSession,
  adoptCodexThreadId,
  buildSessionErrorResponse,
  createSession,
  inspectSessionDiff,
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

  const issueTitle = await resolveTextInput({
    codePrefix: "issue_title",
    fileOption: "issue-title-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --issue-title "<title>" --issue -`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "issue-title"
  });
  if (issueTitle.ok === false) {
    return issueTitle;
  }

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

  const plan = await resolveTextInput({
    codePrefix: "plan",
    fileOption: "plan-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --plan -`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "plan"
  });
  if (plan.ok === false) {
    return plan;
  }

  const issueDetails = await resolveTextInput({
    codePrefix: "issue_details",
    fileOption: "issue-details-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --issue-details -`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "issue-details"
  });
  if (issueDetails.ok === false) {
    return issueDetails;
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
    repairCommand: `jskit session ${sessionId} step --skip-ui-check --skip-reason "<reason>"`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "skip-reason"
  });
  if (skipReason.ok === false) {
    return skipReason;
  }

  const agentDecisions = await resolveTextInput({
    codePrefix: "agent_decisions",
    fileOption: "agent-decisions-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --agent-decisions -`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "agent-decisions"
  });
  if (agentDecisions.ok === false) {
    return agentDecisions;
  }

  const closeReason = await resolveTextInput({
    codePrefix: "close_reason",
    fileOption: "close-reason-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --close-without-merge --close-reason "<reason>"`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "close-reason"
  });
  if (closeReason.ok === false) {
    return closeReason;
  }

  const codexResult = await resolveTextInput({
    codePrefix: "codex_result",
    fileOption: "codex-result-file",
    inlineOptions,
    io,
    repairCommand: `jskit session ${sessionId} step --codex-result -`,
    cwd,
    sessionId,
    stdinOption: "-",
    textOption: "codex-result"
  });
  if (codexResult.ok === false) {
    return codexResult;
  }

  return {
    agentDecisions: agentDecisions.value,
    closeReason: closeReason.value,
    codexResult: codexResult.value,
    issue: issue.value,
    issueTitle: issueTitle.value,
    ok: true,
    plan: plan.value,
    issueDetails: issueDetails.value,
    reworkNotes: reworkNotes.value,
    skipReason: skipReason.value
  };
}

function normalizeStepOptions(inlineOptions = {}) {
  const options = {
    ...inlineOptions,
    closeWithoutMerge: inlineOptions["close-without-merge"] === "true" || inlineOptions.closeWithoutMerge === true,
    mergePr: inlineOptions["merge-pr"] === "true" || inlineOptions.mergePr === true,
    prompt: inlineOptions.prompt,
    reviewFindings: inlineOptions["review-findings"] || inlineOptions.reviewFindings,
    skipUiCheck: inlineOptions["skip-ui-check"] === "true" || inlineOptions.skipUiCheck === true,
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
        payload = await listSessions({
          targetRoot: cwd,
          archive: resolveListArchiveOption(options)
        });
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
                issue: stepInputs.issue,
                issueTitle: stepInputs.issueTitle,
                plan: stepInputs.plan,
                issueDetails: stepInputs.issueDetails,
                reworkNotes: stepInputs.reworkNotes,
                skipReason: stepInputs.skipReason,
                agentDecisions: stepInputs.agentDecisions,
                closeReason: stepInputs.closeReason,
                codexResult: stepInputs.codexResult
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
