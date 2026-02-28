Audit error handling and logs for misleading or invented messages (e.g., error says one thing but catch block swallows real cause, or logs claim success when partial failure happened).
Find catch blocks that discard error context, generic ‘failed’ messages, retries without surfacing, and places returning success codes despite failure.
Output: exact locations + better error strategy.
