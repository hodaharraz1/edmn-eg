## What changes

## Security checklist (docs/security/policy-v1)
- [ ] No secret, token, password or customer data in the diff, logs or screenshots
- [ ] Every new or changed route: authentication, ownership check on every id, input schema, rate limit
- [ ] Money: computed on the server in piastres; idempotency key; no new path that moves, releases, refunds or pays out money
- [ ] New uploads use `storeUpload` with a purpose (type, size and content checks; private by default)
- [ ] Tests added for the change, including a denial test (other user, wrong role)
- [ ] Database: additive migration with a rollback note, or none
- [ ] Mobile: no new permission, no secret in the app, no cleartext outside debug
- [ ] Reviewed by a person (code written with an AI agent included)

## Evidence
CI run, test names, screenshots (test data only).
