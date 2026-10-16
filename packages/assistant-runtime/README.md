
With the existing realtime diagnostic option (`JSKIT_REALTIME_DEBUG=1`, or
`config.realtime.debug=true`), conversation subscriptions emit one `pending`
warning if admission/snapshot reading has not returned within the client's
10-second acknowledgement budget. The warning names the current stage and the
server-generated epoch; a conversation identity is included only after its
successful authorized open. Observer release also records the current stage and
reason. Timers are removed on acknowledgement, failure, replacement, unsubscribe
and connection close. Diagnostics contain no request body or conversation text,
and do not change authorization, subscription deadlines or model work.
