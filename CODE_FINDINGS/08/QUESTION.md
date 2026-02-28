Audit async code for correctness issues: missing await, promise chains not returned, forEach(async…), race conditions, timeouts without cancellation, event listeners not removed, concurrent mutation of shared structures.
Provide examples, explain the bug class, and propose safe patterns.
