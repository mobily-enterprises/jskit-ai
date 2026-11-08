// Claude Code's limit for a Bash call that names none (its BASH_DEFAULT_TIMEOUT_MS default).
const CLAUDE_BASH_DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Steering's request that Claude move its foreground work to the background
 * (Claude's Ctrl+B), and the time limit each Bash call it moves keeps.
 *
 * A moved call loses Claude's own limit, so a wait loop that never ends would
 * hold the turn for good. Each foreground Bash call keeps its limit (its
 * `timeout`, or Claude's default), counted from when it started: once steering
 * has moved it, its task is stopped with Claude's `stop_task` control when that
 * limit passes, as Claude would have stopped it in the foreground. Claude then
 * answers the task notification and the turn settles. A call Claude ran with
 * `run_in_background` has no limit and is never tracked.
 * @param {{
 *   publish: (event: Record<string, any>) => unknown,
 *   running: (taskId: string) => boolean,
 *   counts: () => { pendingCommands: number, backgroundTasks: number }
 * }} dependencies
 */
export function createClaudeSteeringBackground({ publish, running, counts }) {
  const calls = new Map();
  const timers = new Map();
  /** @type {{ request: (request: Record<string, any>) => Promise<unknown> } | null} */
  let client = null;

  // One control request; its diagnostic reports Claude's answer.
  function control(request, stage, failedStage) {
    void client.request(request).then(
      () => publish({ type: "diagnostic", stage, ...counts() }),
      error => publish({ type: "diagnostic", stage: failedStage, error: error.message })
    ).catch(() => {});
  }

  function schedule(call) {
    if (!call.steered || !call.taskId || timers.has(call.taskId) || !running(call.taskId)) return;
    const timer = setTimeout(() => {
      timers.delete(call.taskId);
      if (running(call.taskId)) control({ subtype: "stop_task", task_id: call.taskId }, "steered_command_limit", "steered_command_stop_failed");
    }, Math.max(0, call.startedAt + call.limitMs - Date.now()));
    timer.unref();
    timers.set(call.taskId, timer);
  }

  /**
   * Asks Claude to move every running foreground call to the background. An
   * older CLI refuses, and still reads the steer when its tool call returns.
   * @param {{ request: (request: Record<string, any>) => Promise<unknown> }} steeringClient
   */
  function background(steeringClient) {
    client = steeringClient;
    for (const call of calls.values()) {
      call.steered = true;
      schedule(call);
    }
    control({ subtype: "background_tasks" }, "steering_backgrounded", "steering_background_failed");
  }

  // A content block of an assistant frame: a foreground Bash call starts now.
  function called(block) {
    if (block.type !== "tool_use" || block.name !== "Bash" || !block.id || calls.has(block.id) ||
        block.input?.run_in_background === true) return;
    const timeout = block.input?.timeout;
    calls.set(block.id, { startedAt: Date.now(), taskId: "", steered: false,
      limitMs: Number.isSafeInteger(timeout) && timeout > 0 ? timeout : CLAUDE_BASH_DEFAULT_TIMEOUT_MS });
  }

  // A system frame, after the turn has counted its tasks: task_started names the
  // call its task runs, and a task that has finished needs no limit.
  function received(frame) {
    const call = frame.subtype === "task_started" ? calls.get(frame.tool_use_id) : null;
    if (call) {
      call.taskId = frame.task_id;
      schedule(call);
    }
    for (const [taskId, timer] of timers) {
      if (!running(taskId)) {
        clearTimeout(timer);
        timers.delete(taskId);
      }
    }
  }

  function clear() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    calls.clear();
    client = null;
  }

  return Object.freeze({
    background,
    called,
    received,
    clear
  });
}
