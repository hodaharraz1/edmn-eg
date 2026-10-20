# DNS cutover runbook (document only — nothing here has been executed)

Part of [PRODUCTION_GO_LIVE.md](PRODUCTION_GO_LIVE.md), step 12. Four checklists: PRE-CUTOVER, CUTOVER, POST-CUTOVER, ROLLBACK.

**Scope.** Only these three records may ever change, and only after written owner approval on the cutover day:

| Name | Today | After cutover |
|---|---|---|
| `www.edmneg.com` | legacy / unknown (Kntabo) | A/AAAA → EDMN server IP |
| `admin.edmneg.com` | probably absent | A/AAAA → EDMN server IP |
| `edmneg.com` (apex) | legacy / unknown | A/AAAA → EDMN server IP (the proxy answers it with a 301 to www) |

**Never touched:**
- `api.edmneg.com`
- `server.edmneg.com` (the hosting server's own name)
- MX
- SPF (`TXT v=spf1 …`)
- DKIM (`*._domainkey`)
- `_dmarc`
- `mail.` / `webmail.` / `cpanel.` / `autodiscover.` / `autoconfig.` / `ftp.` and every other record
- nameservers: **no nameserver change by default**; only A/AAAA records of the three names above, at the current DNS host
- registrar settings

The transactional sender's DKIM, and the SPF `include:` merge, are a separate, owner-approved email change; see `PRODUCTION_INFRASTRUCTURE.md` §3.

## 1. PRE-CUTOVER CHECKLIST (T-7 days → T-1 day)
1. Export the complete current zone from the DNS host (the panel export, or `dig` of every known name), with today's date, and store it with the owner. This is the rollback source.
2. Record the current answers for the protected names:

   ```bash
   for n in edmneg.com www.edmneg.com admin.edmneg.com api.edmneg.com mail.edmneg.com webmail.edmneg.com; do
     dig +noall +answer $n A; dig +noall +answer $n AAAA; dig +noall +answer $n CNAME; done
   dig +noall +answer edmneg.com MX; dig +noall +answer edmneg.com TXT; dig +noall +answer _dmarc.edmneg.com TXT
   dig +noall +answer edmneg.com CAA
   ```

3. Find out whether `www`, `edmneg.com` or `admin` currently serve anything (a legacy site). Agree with the owner what replaces it. Cut over only after approval.
4. **Apex vs mail:** check whether the MX target, or the SPF `a`/`ip4` mechanisms, depend on the apex A record (e.g. `MX 0 edmneg.com.`, or SPF `a`). If so, **STOP**: changing the apex A would move or break mail. Then either:
   - keep the apex unchanged and only redirect at the legacy host, or
   - first move the mail dependency to its own name (a mail-team change, outside this runbook).
5. The EDMN server has passed:
   - `preflight-legacy.sh`
   - `deploy.sh first` (SUCCESS)
   - `prod-acceptance --http-only --local`, all PASS
6. The proxy is installed with **port-80 blocks only**, ready for ACME.
7. CAA: if a CAA record exists, it must include `letsencrypt.org` (or the cPanel AutoSSL CA). Otherwise certificate issuance fails.

## 2. PRE-CUTOVER CHECKLIST — TTL strategy
- **T-48 h:** lower the TTL of only `www`, `admin` (if it exists) and the apex A/AAAA to **300 s**. Do not lower any other record.
- Wait at least the **old** TTL before cutting over, so caches hold the short TTL.
- **After a stable 48 h on EDMN:** raise the TTL back to 3600 s.

## 3. CUTOVER CHECKLIST (maintenance window, owner present)
1. Final checks:
   - `deploy/scripts/watch.sh` shows HEALTHY
   - the latest backup is off-server
   - the restore drill PASS is less than 35 days old
2. Change `admin.edmneg.com` first. It is a new name, so the risk is lowest. Issue its certificate, then verify:
   - `https://admin.edmneg.com/` shows the console login
   - `/api/ready` returns 200
3. Change `www.edmneg.com`, then the apex.
4. Issue or expand the certificate for `www.edmneg.com edmneg.com admin.edmneg.com` (certbot webroot, or AutoSSL).
5. Enable the 443 blocks, run `nginx -t` / `apachectl -t`, then reload.
6. Do **not** touch `api.edmneg.com`.

## 4. POST-CUTOVER CHECKLIST (T+0 → T+48 h)

```bash
dig +short www.edmneg.com; dig +short admin.edmneg.com; dig +short edmneg.com     # → EDMN IP
dig +short api.edmneg.com; dig +short edmneg.com MX; dig +short edmneg.com TXT     # → IDENTICAL to the §1 record
curl -sI https://edmneg.com/ | head -3            # 301 → https://www.edmneg.com/ and NO strict-transport-security
curl -s https://www.edmneg.com/api/ready          # {"status":"ready",…}
curl -sI https://www.edmneg.com/admin | grep -i location   # https://admin.edmneg.com/
docker run --rm --network host -e APP_URL=https://www.edmneg.com -e ADMIN_HOST=admin.edmneg.com edmn-app:<sha> \
  node --import tsx scripts/prod-acceptance.ts --http-only           # all PASS incl. HTTP_APEX
```

Then:
- Send one email to `info@edmneg.com` from an outside mailbox and confirm it still arrives. MX is unchanged, so this must pass.
- Check that `api.edmneg.com` answers exactly as before (same status and same content as recorded in §1).
- The external uptime monitor on `/api/ready` is green.

## 5. ROLLBACK CHECKLIST
- **Trigger:** any failed check in §4 that is not fixed within 30 minutes, or any mail or `api` regression (immediate).
- **Action:** restore the A/AAAA values of `www`, apex and `admin` from the §1 export. TTL is 300 s, so this takes effect within minutes.
- The EDMN server keeps running. No data is lost: the database is not involved in DNS.
- Certificates can stay.
- Remove the EDMN proxy file only if the legacy web server must answer those names again from this same server: remove it, run `nginx -t`, then reload.
- Record what happened in the incident log (`INCIDENT_RESPONSE.md`).
