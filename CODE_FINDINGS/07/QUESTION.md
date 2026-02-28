Look for performance hazards: nested loops over large collections, repeated parsing/serialization, synchronous fs calls in hot paths, excessive cloning, repeated regex compilation, unbounded concurrency, per-request expensive initialization.
Rank findings by likely impact and show minimal refactors.
