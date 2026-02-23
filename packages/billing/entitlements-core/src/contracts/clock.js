export const SYSTEM_CLOCK = {
  now: () => new Date()
};

export function validateClock(clock) {
  const target = clock && typeof clock === "object" ? clock : null;
  const missingMethods = [];

  if (!target || typeof target.now !== "function") {
    missingMethods.push("now");
  }

  return {
    valid: missingMethods.length < 1,
    missingMethods
  };
}

export function assertClock(clock, options = {}) {
  const validation = validateClock(clock);
  if (validation.valid) {
    return clock;
  }

  const name = String(options.name || "clock").trim() || "clock";
  throw new Error(`${name}.${validation.missingMethods[0]} must be a function.`);
}

export function resolveClock(clock) {
  if (!clock) {
    return SYSTEM_CLOCK;
  }
  return assertClock(clock);
}
