# Retention Jobs

This project includes a retention sweep script:

- Dry-run: `npm run ops:retention:dry-run`
- Execute: `npm run ops:retention`

## Dry-Run First Policy

Always run dry-run in the target environment before enabling the scheduled job:

1. Run `npm run ops:retention:dry-run`.
2. Verify the computed cutoff dates in the JSON output.
3. Verify retention env vars are correct for the environment.
4. Run one manual non-dry run and review deleted row counts.
5. Enable scheduler only after steps 1-4 are complete.

## Environment Variables

- `ERROR_LOG_RETENTION_DAYS` default `30`
- `INVITE_ARTIFACT_RETENTION_DAYS` default `90`
- `SECURITY_AUDIT_RETENTION_DAYS` default `365`
- `RETENTION_BATCH_SIZE` default `1000`

## Cron Example

Run daily at 03:20 UTC:

```cron
20 3 * * * cd /srv/jskit-ai && /usr/bin/npm run ops:retention >> /var/log/jskit-retention.log 2>&1
```

## systemd Timer Example

Service unit (`/etc/systemd/system/jskit-retention.service`):

```ini
[Unit]
Description=JSKit retention sweep
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/srv/jskit-ai
ExecStart=/usr/bin/npm run ops:retention
User=app
Group=app
```

Timer unit (`/etc/systemd/system/jskit-retention.timer`):

```ini
[Unit]
Description=Run JSKit retention sweep daily

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jskit-retention.timer
sudo systemctl list-timers --all | grep jskit-retention
```
