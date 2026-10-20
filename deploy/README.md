# EDMN — self-hosted production package

Everything needed to run EDMN on the existing server as a controlled infrastructure operation. No product code
is involved. Procedures: [`docs/runbooks/SELF_HOSTED_DEPLOYMENT.md`](../docs/runbooks/SELF_HOSTED_DEPLOYMENT.md) and
[`docs/runbooks/SELF_HOSTED_DNS_CUTOVER.md`](../docs/runbooks/SELF_HOSTED_DNS_CUTOVER.md).

| Path | Purpose |
|---|---|
| `compose/docker-compose.prod.yml` | `web` + `worker` (same image, tag = commit SHA). One-off `migrate` / `migrate-preflight` / `seed` / `acceptance` (profile `ops`). Optional `postgres` (`postgres-local`) and `clamd` + `scanner` (`scanner`). |
| `compose/postgres/init/01-roles.sh` | Creates the `edmn_owner` / `edmn_app` (DML only) / `edmn_backup` (read-only) roles. UTF8, UTC. Runs only on an empty volume. |
| `proxy/nginx/edmn.conf`, `nginx-tls.conf` | nginx template for www, apex and admin. Includes guard blocks, never captures `api.edmneg.com`, and answers the apex itself. |
| `proxy/apache/edmn.conf` | Apache template. Standalone vhosts (A), or a cPanel userdata include (B). |
| `systemd/edmn-{tick,backup,watch}.{service,timer}` | Scheduler watchdog (1 min), daily backup, and health watch (5 min). |
| `scripts/deploy.sh` | `first` / `normal`: the 12-step deploy with STOP and app-image-only auto rollback. |
| `scripts/preflight-legacy.sh` | Read-only legacy discovery. STOPs when no-conflict cannot be proven. |
| `scripts/backup.sh`, `verify-backup.sh`, `restore-drill.sh` | Encrypted `pg_dump`, verification, and restore drill into a throwaway database. |
| `scripts/rollback.sh` | `app [<sha>]` switches the image back. `database` prints the manual procedure only. |
| `scripts/watch.sh`, `tick.sh` | Local monitoring (evidence-based) and the watchdog tick. |
| `hardening/ubuntu-debian.sh`, `almalinux-rocky.sh` | Server baseline. Dry run by default; `--apply` executes. |
| `../.env.production.example` | Every production variable, with names and placeholders only, and a launch-tier marker on each. |
| `../scripts/prod-acceptance.ts` | Read-only production acceptance suite. |
| `../scripts/worker-health.mjs` | Worker heartbeat probe (container healthcheck and `watch.sh`). |

Nothing in this directory has been executed against any real server, DNS zone or database.
