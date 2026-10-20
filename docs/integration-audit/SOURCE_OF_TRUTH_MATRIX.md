# Proposed Source of Truth Matrix (recommendation only — nothing changed)

`UNDECIDED` is used wherever legacy evidence is missing. "Legacy" column = owner-reported only.

| Domain | Legacy | New (B) | Proposed future source | Reason |
|---|---|---|---|---|
| Users (existing) | Reported | Yes | **Legacy** (until identity mapping approved) | Holds real customers today; B has no production data |
| Users (unified, future) | — | — | UNDECIDED | Needs identity design after legacy schema |
| KYC (customers) | Reported | No | **Legacy** | Only implementation |
| Seller KYB | UNKNOWN | Yes | **New** | Only known implementation; link to legacy KYC when the person exists there |
| Wallet | Reported | No | **Legacy** | Only implementation |
| Top-ups | Reported | No | **Legacy** | Only implementation |
| Customer withdrawals | Reported | No | **Legacy** | Only implementation |
| Seller withdrawals | — | Yes | **New** | Only implementation |
| Guarantees | Reported | No | **Legacy** | Core product; must be preserved |
| External deals | — | Yes | **New** | Only implementation |
| Products / catalog | — | Yes | **New** | NEW_ONLY |
| Orders | — | Yes | **New** | NEW_ONLY |
| Payments (marketplace orders/deals) | — | Yes | **New** | NEW_ONLY |
| Payments (top-ups/guarantee deposits) | Reported | No | **Legacy** | |
| Ledger (new activity) | UNKNOWN | Yes | **New** for marketplace flows | Double-entry, immutable |
| Ledger (historical legacy money) | UNKNOWN | — | **Legacy (read-only historical)** | Never rewrite history |
| Commissions | — | Yes | **New** | NEW_ONLY |
| Guarantee fees | Reported | — | **Legacy** | Different fee model |
| Shipping | — | Yes | **New** | NEW_ONLY |
| Returns | — | Yes | **New** | NEW_ONLY |
| Disputes | UNKNOWN | Yes | UNDECIDED | Depends on legacy dispute handling |
| Tickets | Reported | Yes | UNDECIDED | Unify after status mapping |
| Roles / permissions | Reported | Yes | UNDECIDED | Needs namespaced design |
| Audit / activity logs | Reported | Yes | **Each system for its own history**; unified viewer later | Logs are immutable evidence |
| Notifications | Reported | Yes | UNDECIDED | Push channel lives in legacy |
| Files | Reported | Yes | **Owning system per file** | Files never move |
| Settings | Reported | Yes | **Each system for its own domains** | Namespaced later |
