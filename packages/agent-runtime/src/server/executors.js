import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Where commands run. An executor's `spawn({ script, cwd, mounts })` starts `bash -c script` in
// `cwd` and resolves to its child process (stdout, stderr, "close"; `kill()` ends all of it).
// `mounts` are other folders the command may read ({ source }). Neither executor passes this
// server's environment on, so no key or password reaches a command.
const ENV = { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TERM: "dumb" };
const onPath = (program) => (program.includes("/") ? existsSync(program) : ENV.PATH.split(":").some((dir) => existsSync(path.join(dir, program))));

// gVisor (the default): the command runs on gVisor's own kernel, rootless and with no network. It
// sees this machine's programs read-only, an empty /tmp, empty stand-ins for the folders that hold
// people's and services' own files (`hide`), and can change only the workspace, at the same path
// as outside. Needs gVisor's runsc (https://gvisor.dev): AGENT_RUNSC, or on the PATH.
export const GVISOR = {
  runsc: process.env.AGENT_RUNSC || "runsc",
  hide: ["/home", "/root", "/run", "/var", "/srv", "/mnt", "/media", "/etc/ssh"],
  scratch: "1g",
  processes: 256,
  processMemory: 2 * 1024 ** 3
};

export function gvisorExecutor(settings = {}) {
  const { runsc, hide, scratch, processes, processMemory } = { ...GVISOR, ...settings };
  const limit = (type, value) => ({ type, hard: value, soft: value });
  const bind = (source, readonly) => ({ destination: source, type: "bind", source, options: ["rbind", readonly ? "ro" : "rw"] });
  const tmpfs = (destination, options = []) => ({ destination, type: "tmpfs", source: "tmpfs", options });

  return {
    kind: "gvisor",
    available: () => onPath(runsc),
    async spawn({ script, cwd, mounts = [] }) {
      const id = `agent-${randomUUID()}`;
      const dir = await mkdtemp(path.join(os.tmpdir(), "agent-run-"));
      const state = ["--root", path.join(dir, "state")];
      await writeFile(path.join(dir, "config.json"), JSON.stringify({
        ociVersion: "1.0.0",
        process: {
          user: { uid: 0, gid: 0 },
          args: ["/bin/bash", "-c", script],
          env: Object.entries(ENV).map(([key, value]) => `${key}=${value}`),
          cwd,
          noNewPrivileges: true,
          capabilities: { bounding: [], effective: [], inheritable: [], permitted: [], ambient: [] },
          rlimits: [limit("RLIMIT_NPROC", processes), limit("RLIMIT_AS", processMemory), limit("RLIMIT_CORE", 0)]
        },
        root: { path: "/", readonly: true },
        hostname: "agent",
        mounts: [
          { destination: "/proc", type: "proc", source: "proc" },
          tmpfs("/dev"),
          tmpfs("/tmp", [`size=${scratch}`, "mode=1777"]),
          ...hide.filter((folder) => existsSync(folder)).map((folder) => tmpfs(folder, ["size=1m"])),
          bind(cwd, false),
          ...mounts.map((mount) => bind(mount.source, true))
        ],
        linux: { namespaces: [{ type: "pid" }, { type: "network" }, { type: "ipc" }, { type: "uts" }, { type: "mount" }] }
      }));
      const child = spawn(runsc, ["--rootless", "--network=none", "--ignore-cgroups", "--overlay2=root:memory", ...state, "run", "--bundle", dir, id], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
      const kill = child.kill.bind(child);
      child.kill = () => {
        execFile(runsc, [...state, "kill", id, "KILL"], () => {});
        return kill("SIGKILL");
      };
      child.once("close", () => execFile(runsc, [...state, "delete", "-force", id], () => rm(dir, { recursive: true, force: true }).catch(() => {})));
      return child;
    }
  };
}

/**
 * The local process (opt in): bash in the workspace, with this machine's programs and no sandbox,
 * for a trusted machine or a container of its own.
 */
export function localExecutor() {
  return {
    kind: "local",
    available: () => true,
    async spawn({ script, cwd }) {
      const child = spawn("/bin/bash", ["-c", script], { cwd, env: ENV, stdio: ["ignore", "pipe", "pipe"], detached: true });
      // The command and everything it started.
      child.kill = () => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already ended.
        }
        return true;
      };
      return child;
    }
  };
}
