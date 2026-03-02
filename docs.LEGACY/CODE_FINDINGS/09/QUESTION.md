Map all inputs (CLI args, env vars, HTTP requests, file reads, IPC, plugin loading).
Identify trust boundary violations: unsanitized interpolation into shell commands, path traversal, unsafe YAML/JSON parsing, eval/new Function, dynamic require/import from user input, weak auth checks, missing permission checks.
Output a threat list + concrete fixes.
