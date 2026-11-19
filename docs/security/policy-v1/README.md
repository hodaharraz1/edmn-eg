# تطبيق السياسة الأمنية الموحدة v1.0 على EDMN

**التاريخ:** 19 نوفمبر 2026 · **الفرع:** `claude/security-policy-v1`

المخرجات الإلزامية التسعة (القسم «سابعًا» من السياسة):

| المخرج | الملف |
|---|---|
| Security Inventory | [SECURITY_INVENTORY.md](SECURITY_INVENTORY.md) |
| Threat Model | [THREAT_MODEL_MOBILE_AND_AI.md](THREAT_MODEL_MOBILE_AND_AI.md) + [../THREAT_MODEL.md](../THREAT_MODEL.md) (الويب والمال، أكتوبر) |
| Security Control Register (160) | [SECURITY_CONTROL_REGISTER.md](SECURITY_CONTROL_REGISTER.md) |
| Vulnerability Register | [VULNERABILITY_REGISTER.md](VULNERABILITY_REGISTER.md) + [../SECURITY_FINDINGS.md](../SECURITY_FINDINGS.md) |
| Security Test Results | [SECURITY_TEST_RESULTS.md](SECURITY_TEST_RESULTS.md) |
| Remediation Report | [REMEDIATION_REPORT.md](REMEDIATION_REPORT.md) |
| Backup & Recovery Evidence | [BACKUP_RECOVERY_EVIDENCE.md](BACKUP_RECOVERY_EVIDENCE.md) |
| Incident Response Plan | [INCIDENT_RESPONSE_PLAN.md](INCIDENT_RESPONSE_PLAN.md) |
| Security Release Gate Report | [SECURITY_RELEASE_GATE.md](SECURITY_RELEASE_GATE.md): **NO-GO للإنتاج** |

**الأدلة الخام** في `evidence/`:
- نتائج فحص IDOR؛
- تمرين الاستعادة؛
- SBOM.

لا تحتوي أي سر.

**إعادة تشغيل الفحوص:**
- `npm audit --omit=dev --audit-level=high`
- `npx tsx scripts/secret-scan.ts --history`
- `npx tsx scripts/restore-drill.ts --source <url>`
- `npm run ledger:check`
- Semgrep: `semgrep scan --config p/owasp-top-ten --config p/typescript --config p/nextjs --config p/secrets --config p/jwt src scripts apps packages`
