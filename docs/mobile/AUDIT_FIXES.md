# Mobile audit fixes

Base: `a99ffcdd408236124ab5e4e37e3b8ed7b0f08058`, targeting `claude/edmn-mobile-integration`.

| Finding | Change | Regression coverage |
|---|---|---|
| Text-only deal change waived voluntary returns | Omitted policy preserves the offered policy; the app sends only the user's text | Mobile deal integration and customer widget test |
| Internal support attachment accessible to requester by known id | File authorization excludes internal support messages | Mobile messaging integration, direct file request |
| Statement economics truncated to last 200 rows | Aggregate lifetime economics before limiting displayed entries | Statement unit test with 206 entries |
| Old activity unsearchable | Owned payment/refund/payout UNION, search before limit, deterministic pages and hasMore; UI next/previous | 105-record integration scenario and text reference search |
| Historical refund TEST label followed current platform mode | Read original payment snapshot; missing legacy link is unknown, never inferred from current settings | Real-origin refund while platform mode is TEST; legacy null case |
| Seen advanced while chat covered or scrolled away | Current route + foreground + viewport intersection of actual incoming bubbles; sending no longer advances reads | Long-thread/covered-route widget test; realtime integration |
| Payout preview incomplete | Reuse request eligibility checks; show transfer cost, expected net, warnings and violations | Below-minimum preview and cost/net assertions |
| Retry key reused for changed intent | Freeze pending app input; reject changed withdrawal amount/destination; atomically fingerprint message body and original attachment bytes with the existing idempotency table | Changed body/file/payout retries and existing same-key tests |
| PDF label could not open/download | Explicit authenticated download/save action using the existing file picker; chat and support | Widget download action with injected saver |
| Activity detail depended on an in-memory row | Owner-scoped detail endpoint; fetch by route id and pull to refresh | Detail owner isolation and direct-route widget test |

No new schema migration, posting, approval rule, transfer execution endpoint, or real-money activation is included.
New message fingerprints use the existing `idempotency_keys` table with a domain scope and no expiry. Legacy messages
without a fingerprint keep their previous replay behavior, with text conflicts rejected.

Channel rolling limits retain their existing request policy: show warnings now and revalidate at approval. The preview
is a snapshot, not a reservation or approval. Pagination uses stable timestamp/kind/id ordering; it is offset based,
so new operations can shift page boundaries during concurrent browsing.

The CI workflow now runs Flutter analysis and tests for all five packages/apps on Flutter 3.47.8 in addition to the
existing backend gates. Vercel auto-deploy is explicitly disabled for `codex/mobile-audit-fixes`.

This fixes the audited defects. Missing product features in SCREEN_INVENTORY (returns/disputes UI, notifications,
password-reset deep link, top-up business decisions, physical-device QA) remain separate work.
