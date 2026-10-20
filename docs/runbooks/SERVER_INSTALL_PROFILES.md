# Server installation profiles (prepared — NOT executed)

Use this after `server-discovery.sh` and `evaluate-server.mjs` (see [PRODUCTION_GO_LIVE.md](PRODUCTION_GO_LIVE.md) steps 1–2), and **only with Kntabo's written approval**.

Every step is idempotent: re-running it changes nothing that is already in place. Every procedure STOPs if the legacy-safety gate fails.

**Nothing here removes, replaces, stops or reconfigures:**
- Apache, nginx or LiteSpeed
- cPanel/WHM
- MySQL/MariaDB or PostgreSQL
- Exim, Dovecot or Postfix
- legacy Docker containers or legacy applications

## Common prerequisites (all profiles)
1. Keep a **second root SSH session** open for the whole procedure (lock-out safety).
2. Keep `discovery.json` and the evaluator output in the go-live log.
3. Clone the release checkout:

   ```bash
   sudo install -d -m 0750 /opt/edmn && sudo git clone <repo> /opt/edmn
   cd /opt/edmn && sudo git checkout <release sha>
   ```

4. Run the baseline. **Dry run first, read every line, then apply:**

| OS | Command |
|---|---|
| Ubuntu 20.04+ / Debian 11+ | `sudo deploy/hardening/ubuntu-debian.sh` then `sudo deploy/hardening/ubuntu-debian.sh --apply` |
| AlmaLinux / Rocky / RHEL / CloudLinux 8–9 | `sudo deploy/hardening/almalinux-rocky.sh` then `--apply` |

   What the baseline does:
   - creates the `edmn` user and the directory layout in [PRODUCTION_GO_LIVE.md §2](PRODUCTION_GO_LIVE.md)
   - security updates
   - key-only SSH (it refuses if no key is installed)
   - firewall: SSH, 80, 443, plus **every port already listening**
   - fail2ban
   - Docker CE + Compose plugin (only if absent)
   - Docker log rotation (only if no `daemon.json` exists)
   - `age`
   - installs the systemd units (not enabled)

   On cPanel/WHM or CSF servers, the **firewall and SSH steps are skipped automatically**.

5. Run `sudo deploy/scripts/preflight-legacy.sh`. It **must** print `✓ no conflict found`. On any `✗ STOP`, stop here and resolve it with Kntabo; do not work around it.
6. Get the release image. Either:
   - build on the server: `docker build --build-arg EDMN_RELEASE=<sha> -t edmn-app:<sha> .`, or
   - load an archive built elsewhere: `docker load -i edmn-<sha>.tar` (check its `.sha256` first).

## Profile A — existing Apache / LiteSpeed / cPanel in front → Docker EDMN

Use this when the evaluator reports proxy `A`: cPanel/WHM present, or httpd/apache2/LiteSpeed owns 80/443.

1. The app listens on `127.0.0.1:${EDMN_WEB_PORT:-3000}` only. Pick a free port if the preflight warned.

**With cPanel/WHM:**

2. Kntabo adds `www.edmneg.com`, `admin.edmneg.com` and `edmneg.com` to the right cPanel account, as an addon/alias. This is a WHM change and needs explicit approval. If the domain already exists with a legacy site, nothing is replaced until the DNS cutover.
3. Put **section B** of `deploy/proxy/apache/edmn.conf` into the userdata includes:
   - `/etc/apache2/conf.d/userdata/ssl/2_4/<user>/www.edmneg.com/edmn-proxy.conf`
   - the same for `admin.edmneg.com`
   - the `std/2_4` path for port 80 (ACME exception + redirect)
4. Save `apachectl -S` to `before.txt`, then run `/usr/local/cpanel/scripts/rebuildhttpdconf` and `apachectl -t`.
5. Run `/scripts/restartsrv_httpd --graceful`, then save `apachectl -S` to `after.txt`.
6. The two "default server" lines must be **identical**. Any other difference must show EDMN names only.
7. The apex `edmneg.com` must be a 301 to www **at Apache**, never proxied. Use a cPanel redirect, or the section-A apex vhost on non-cPanel servers.
8. TLS: AutoSSL issues the certificates once DNS points here (cutover step).

**Without cPanel:** use section A (full vhosts) in a new file under `conf.d` / `sites-available`, then `apachectl -t` and a graceful reload.

**LiteSpeed:** it reads Apache config; apply the same include. Kntabo confirms the LiteSpeed restart command.

**Rollback:** remove the include or file, rebuild/test, graceful restart. Legacy configuration is untouched.

## Profile B — nginx in front → Docker EDMN

Use this when the evaluator reports proxy `B`: nginx owns 80/443, or 80/443 are free.

1. If 80/443 are **free**:
   - install nginx from the distribution: `apt-get install nginx` or `dnf install nginx` (needs approval);
   - remove nothing.
2. If nginx **already exists**:
   - the evaluator and preflight require an **explicit `default_server`** on 80 and 443;
   - if missing, Kntabo adds one to the legacy configuration (a legacy change: their decision, not ours).
3. Save `nginx -T` to `before.txt`.
4. Install:
   - `deploy/proxy/nginx/edmn.conf` as the **last-loaded** file: `/etc/nginx/sites-enabled/zz-edmn.conf` (Debian/Ubuntu) or `/etc/nginx/conf.d/zz-edmn.conf` (RHEL family);
   - `deploy/proxy/nginx/nginx-tls.conf` to `/etc/edmn/nginx-tls.conf`;
   - `install -d /var/www/letsencrypt`.
5. **Before DNS and certificates exist:** comment out the three 443 server blocks (nginx refuses missing certificate files). If the host has no IPv6, remove the `[::]` listens.
6. Run `nginx -t && systemctl reload nginx`, then save `nginx -T` to `after.txt`. The diff must contain only the EDMN file.
7. TLS after the DNS cutover:
   - `certbot certonly --webroot -w /var/www/letsencrypt -d www.edmneg.com -d edmneg.com -d admin.edmneg.com`
   - uncomment the 443 blocks, `nginx -t`, reload
   - `certbot renew --dry-run`

**Rollback:** remove `zz-edmn.conf`, then `nginx -t`, then reload.

## Profile C — application on this server + EXTERNAL PostgreSQL

Use this when the evaluator reports `C`: RAM < 3.5 GB or disk < 40 GB.

- The web tier follows profile A or B as reported.
- The database follows [PRODUCTION_DATABASE_PLAN.md](PRODUCTION_DATABASE_PLAN.md) option B:
  - do **not** enable compose profile `postgres-local`;
  - `DATABASE_URL` uses `sslmode=require`;
  - `BACKUP_DOCKER_NETWORK=edmn_edge`.
- ClamAV on a ≤ 6 GB host: run the `scanner` profile on another host behind HTTPS, or leave it off. Private files then stay QUARANTINED (fail-closed) until it exists; see [PRODUCTION_PROVIDER_MATRIX.md](PRODUCTION_PROVIDER_MATRIX.md).

## After any profile
Continue with [PRODUCTION_GO_LIVE.md](PRODUCTION_GO_LIVE.md) step 5 (secrets). Then:
- `deploy.sh first`
- the first admin
- `systemctl enable --now edmn-watch.timer edmn-backup.timer edmn-tick.timer`

On a server without systemd, use cron:
- `* * * * *` → `tick.sh`
- `*/5 * * * *` → `watch.sh`
- `15 1 * * *` → `backup.sh --reason daily`
