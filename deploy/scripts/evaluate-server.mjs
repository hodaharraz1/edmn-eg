#!/usr/bin/env node
/**
 * EDMN — OFFLINE server compatibility evaluator. Reads the discovery.json written by server-discovery.sh and prints
 * a decision. It never connects to the server and never applies anything: the recommendation is advice for the
 * humans who decide (owner + Kntabo).
 *
 *   node deploy/scripts/evaluate-server.mjs discovery.json [--json]
 *
 * Verdict:  SUPPORTED | SUPPORTED_WITH_WARNINGS | BLOCKED          (exit 0 | 0 | 2)
 * Profile:  A  existing Apache/LiteSpeed/cPanel in front → Docker EDMN (deploy/proxy/apache)
 *           B  nginx in front (existing, or installed because 80/443 are free) → Docker EDMN (deploy/proxy/nginx)
 *           C  as A/B for the web tier, but PostgreSQL EXTERNAL (server too small / disk too tight for a local DB)
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};
const present = (v) => !!v && !/^(absent|unknown|inactive|failed|none)\b/i.test(String(v).trim()) && String(v).trim() !== '';
const owner = (v) => String(v ?? '').trim();

export function evaluate(d) {
  const checks = [];
  const add = (area, level, detail) => checks.push({ area, level, detail }); // level: OK | WARN | BLOCK
  const mem = num(d.mem_total_mb);
  const cpu = num(d.cpu_count);
  const disk = num(d.var_fs_free_gb) ?? num(d.root_fs_free_gb);
  const p80 = owner(d.port_80_owner);
  const p443 = owner(d.port_443_owner);
  const web = `${p80} ${p443}`;
  const cpanel = present(d.cpanel_version);
  const apacheFront = /httpd|apache2|litespeed|lshttpd|lsws/i.test(web);
  const nginxFront = /nginx/i.test(web);

  if (d.schema !== 'edmn-discovery/1') add('report', 'BLOCK', `unknown report schema ${d.schema}`);
  if (d.run_as_root !== 'yes') add('report', 'BLOCK', 'discovery was not run as root: listeners, vhosts and api.edmneg.com references are incomplete — re-run with sudo');

  // Platform / Docker
  if (!/^(x86_64|aarch64|arm64)$/.test(d.arch ?? '')) add('platform', 'BLOCK', `unsupported architecture ${d.arch}`);
  const os = `${d.os_id} ${d.os_version}`;
  const supportedOs = /^(ubuntu (2[0-9])|debian (1[1-9])|(almalinux|rocky|rhel|cloudlinux) ([89]|1[0-9]))/.test(os.toLowerCase());
  if (present(d.docker_version) && !/client-only/.test(d.docker_version)) {
    add('docker', present(d.docker_compose_version) ? 'OK' : 'WARN', `Docker ${d.docker_version}; compose ${d.docker_compose_version}${present(d.docker_compose_version) ? '' : ' — install the compose v2 plugin'}`);
  } else if (/openvz|lxc/i.test(d.virtualization ?? '')) {
    add('docker', 'BLOCK', `virtualization ${d.virtualization}: Docker is usually impossible in this container type — ask Kntabo, or choose another host`);
  } else if (supportedOs) {
    add('docker', 'WARN', `Docker not installed (${os}) — install via deploy/hardening/*.sh after Kntabo approves`);
  } else {
    add('docker', 'BLOCK', `Docker absent and OS "${os}" is not a supported install target (Ubuntu ≥20, Debian ≥11, AlmaLinux/Rocky 8/9)`);
  }
  if (/podman/i.test(d.podman ?? '') && !present(d.docker_version)) add('docker', 'WARN', 'podman present: install Docker CE alongside; do not use the podman-docker shim for compose');

  // Capacity
  if (mem === null) add('ram', 'BLOCK', 'RAM unknown');
  else if (mem < 1800) add('ram', 'BLOCK', `${mem} MB RAM: below the 2 GB minimum for web + worker`);
  else if (mem < 3500) add('ram', 'WARN', `${mem} MB RAM: web + worker only — use EXTERNAL PostgreSQL and no local ClamAV`);
  else add('ram', 'OK', `${mem} MB RAM`);
  if (cpu === null || cpu < 1) add('cpu', 'BLOCK', 'CPU count unknown');
  else if (cpu < 2) add('cpu', 'WARN', `${cpu} vCPU: builds must happen off-server (docker load an image archive)`);
  else add('cpu', 'OK', `${cpu} vCPU`);
  if (disk === null) add('disk', 'BLOCK', 'free disk unknown');
  else if (disk < 20) add('disk', 'BLOCK', `${disk} GB free: below 20 GB (image ~2 GB ×2 releases, database, local backups)`);
  else if (disk < 40) add('disk', 'WARN', `${disk} GB free: tight for a local database + 14 days of local backups — prefer external PostgreSQL`);
  else add('disk', 'OK', `${disk} GB free`);
  const pressure = String(d.disk_pressure ?? '').trim();
  if (pressure) add('disk', 'WARN', `filesystems ≥80% used: ${pressure.replace(/\n/g, '; ')}`);

  // Ports / legacy collision
  if (owner(d.port_3000_owner) && !/docker-proxy/.test(d.port_3000_owner)) add('ports', 'WARN', `port 3000 used by ${d.port_3000_owner}: set EDMN_WEB_PORT to a free loopback port`);
  const unknownFront = [p80, p443].filter((o) => o && !/nginx|httpd|apache2|litespeed|lshttpd|lsws|docker-proxy|haproxy|caddy|traefik/i.test(o));
  if (unknownFront.length) add('legacy', 'BLOCK', `80/443 owned by an unrecognised process (${unknownFront.join(', ')}) — identify it with Kntabo first`);
  if (/haproxy|caddy|traefik|docker-proxy/i.test(web)) add('legacy', 'BLOCK', `80/443 owned by ${web.trim()}: no EDMN template for this front proxy — decide with Kntabo`);
  if (nginxFront && d.nginx_default_server !== 'explicit') add('legacy', 'BLOCK', 'nginx serves 80/443 without an explicit default_server: adding EDMN could change who answers unknown hosts (possibly api.edmneg.com) — Kntabo must confirm/add an explicit default first');
  if (nginxFront && apacheFront) add('legacy', 'WARN', 'both nginx and Apache/LiteSpeed own 80/443 (front-end proxy chain) — install EDMN in the FRONT server only');
  const apiRefs = String(d.refs_api_edmneg_com ?? '');
  if (/unknown/.test(apiRefs)) add('legacy', 'BLOCK', 'api.edmneg.com references unknown (not root)');
  else if (apiRefs && apiRefs !== 'none') add('legacy', 'OK', `api.edmneg.com is configured locally (${apiRefs.split('\n').length} file(s)) — preflight-legacy.sh baselines and watches these; never edit them`);
  else add('legacy', 'OK', 'no local api.edmneg.com configuration (hosted elsewhere or not present) — confirm with Kntabo');
  for (const h of ['www_edmneg_com', 'admin_edmneg_com']) {
    const r = String(d[`refs_${h}`] ?? '');
    if (r && r !== 'none' && !/unknown/.test(r)) add('legacy', 'WARN', `${h.replace(/_/g, '.')} already configured on this server (${r.split('\n')[0]}…) — a legacy site exists; cutover replaces only its proxying, after approval`);
  }
  if (present(d.exim) || present(d.dovecot) || present(d.postfix) || owner(d.port_25_owner)) add('mail', 'OK', 'local mail services present — never touched (no MX/mail change in any EDMN step)');

  // PostgreSQL
  let pg = 'LOCAL';
  if ((mem !== null && mem < 3500) || (disk !== null && disk < 40)) {
    pg = 'EXTERNAL';
    add('postgres', 'WARN', 'capacity favours EXTERNAL PostgreSQL (profile C)');
  } else add('postgres', 'OK', 'local PostgreSQL 16 container feasible (no published port; an existing host PostgreSQL/MySQL is not touched)');
  if (owner(d.port_5432_owner)) add('postgres', 'OK', `a host PostgreSQL already listens on 5432 (${d.port_5432_owner}) — EDMN's container publishes no port: no conflict; never reuse the legacy instance`);

  // ClamAV
  let clam = 'LOCAL';
  if (mem === null || mem < 6000) {
    clam = 'DEFERRED';
    add('clamav', 'WARN', `ClamAV needs ~3 GB RAM on top of the app: ${mem ?? '?'} MB is not enough — run the scanner profile on another host, or keep private files QUARANTINED (fail-closed) until one exists`);
  } else add('clamav', 'OK', 'local clamd + private scanner (compose profile "scanner") feasible');
  if (present(d.clamav_version)) add('clamav', 'OK', `host ClamAV present (${d.clamav_version}) — EDMN uses its own container; the host daemon is not touched`);

  // Backups
  add('backup', 'WARN', 'an OFF-SERVER destination is mandatory (until configured every backup is "LOCAL COPY — NOT DISASTER-RECOVERY BACKUP")');
  if (!present(d.systemd)) add('backup', 'WARN', 'no systemd: schedule backup.sh / watch.sh / tick.sh with cron instead of the provided timers');

  // Security tooling (informational)
  if (present(d.firewall_csf)) add('security', 'OK', 'CSF manages the firewall — the hardening scripts skip firewall/SSH steps; open nothing new (EDMN needs only 80/443, already open)');

  // Proxy profile
  let proxy;
  if (cpanel || apacheFront) proxy = 'A';
  else if (nginxFront) proxy = 'B';
  else {
    proxy = 'B';
    add('proxy', 'WARN', '80/443 are free: install nginx (profile B) — needs Kntabo approval');
  }
  if (cpanel) add('proxy', 'OK', 'cPanel/WHM: use the Apache userdata include (section B) — never edit httpd.conf, never install a second web server on 80/443');

  const profile = pg === 'EXTERNAL' ? `C (web via profile ${proxy}, PostgreSQL external)` : proxy;
  const verdict = checks.some((c) => c.level === 'BLOCK') ? 'BLOCKED' : checks.some((c) => c.level === 'WARN') ? 'SUPPORTED_WITH_WARNINGS' : 'SUPPORTED';
  return { verdict, profile, proxy, postgres: pg, clamav: clam, checks, applied: false };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node evaluate-server.mjs <discovery.json> [--json]');
    process.exit(64);
  }
  const r = evaluate(JSON.parse(readFileSync(file, 'utf8')));
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    for (const c of r.checks) console.log(`${c.level.padEnd(5)} ${c.area.padEnd(9)} ${c.detail}`);
    console.log(`\nVERDICT: ${r.verdict}\nRECOMMENDED PROFILE: ${r.profile}\nPOSTGRES: ${r.postgres}   CLAMAV: ${r.clamav}`);
    console.log('Nothing was applied. The owner and Kntabo decide; then follow docs/runbooks/PRODUCTION_GO_LIVE.md.');
  }
  process.exit(r.verdict === 'BLOCKED' ? 2 : 0);
}
