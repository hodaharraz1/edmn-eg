#!/usr/bin/env bash
# EDMN — on-server backup verification (deploy step 3).  verify-backup.sh <edmn-…dump.age|gpg>
#
# What the server CAN prove without the private key: the encrypted file is intact (sha256 = manifest = .sha256),
# non-trivial, recent, its manifest shows a migrated PRODUCTION database with table data, and the plaintext was a
# valid pg_restore archive at creation time (recorded before encryption).
# What only a RESTORE DRILL proves (restore-drill.sh, with the offline private key): that it actually restores and
# the restored ledger balances. Both results are reported separately — never merged into one "verified".
source "$(dirname "$0")/lib.sh"

F="${1:-}"
[ -f "$F" ] || stop "usage: verify-backup.sh <encrypted backup file>"
M="$F.manifest.json"
[ -f "$M" ] || stop "manifest missing: $M"
[ -f "$F.sha256" ] || stop "checksum file missing: $F.sha256"
(cd "$(dirname "$F")" && sha256sum -c "$(basename "$F").sha256" >/dev/null) || stop "checksum mismatch — backup corrupted"
want="$(sed -n 's/.*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$M" | head -n1)"
have="$(sha256sum "$F" | cut -d' ' -f1)"
[ "$want" = "$have" ] || stop "manifest sha256 does not match the file"
size="$(stat -c %s "$F")"; [ "$size" -gt 10240 ] || stop "backup is implausibly small ($size bytes)"
entries="$(sed -n 's/.*"table_data_entries":\([0-9]*\).*/\1/p' "$M")"; [ "${entries:-0}" -gt 0 ] || stop "no table data recorded"
grep -Eq '"marker"[[:space:]]*:[[:space:]]*"PRODUCTION"' "$M" || stop "manifest does not show a PRODUCTION-marked database"
case "$F" in
  *.age) head -c 64 "$F" | grep -q 'age-encryption.org' || stop "not an age-encrypted file";;
  *.gpg) command -v gpg >/dev/null && { gpg --batch --list-packets "$F" 2>/dev/null | grep -q 'pubkey enc packet' || stop "not a GnuPG public-key-encrypted file"; };;
  *) stop "unknown backup extension";;
esac
ok "backup intact: $(basename "$F") ($size bytes, $entries table-data entries, PRODUCTION marker)"
log "NOTE: restorability is proven only by restore-drill.sh (offline key) — run it after the first deploy and monthly"
