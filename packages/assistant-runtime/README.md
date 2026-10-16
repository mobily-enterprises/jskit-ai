
With the existing realtime diagnostic option (`JSKIT_REALTIME_DEBUG=1`, or
`config.realtime.debug=true`), conversation subscriptions emit one `pending`
warning if admission/snapshot reading has not returned within the client's
10-second acknowledgement budget. The warning names the current stage and the
server-generated epoch; a conversation identity is included only after its
successful authorized open. Observer release also records the current stage and
reason. Timers are removed on acknowledgement, failure, replacement, unsubscribe
and connection close. Diagnostics contain no request body or conversation text,
and do not change authorization, subscription deadlines or model work.

Prepared application submissions may explicitly enable `queueWhileSending` to
reuse the binding's serial delivery queue while application preparation is still
running. Each queued request retains its captured payload and receipt identity.
Stop and conversation retirement cancel queued preparation through the existing
owner. A typed, definite ended-turn rejection may become one ordinary Send with
the same identity, without repeating preparation; uncertain delivery never
permits replay. With the option absent or false, prepared submissions retain
their existing non-queueing behavior.
