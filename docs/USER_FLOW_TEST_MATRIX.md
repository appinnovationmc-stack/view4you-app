# User flow test matrix

Legend: **DB** = covered by automated tests on real Postgres (PGlite) · **Unit** = automated unit test · **Manual** = not yet run, needs a real backend/device · **Not built**.

| Flow | Buyer / Inspector | Evidence |
|------|-------------------|----------|
| Sign up (role chosen, profile created by trigger, inspector starts unapproved) | both | DB |
| Role self-elevation blocked | buyer | DB |
| Sign in / session restore | both | Manual |
| Search VIN, vehicle + history | buyer | Manual; only CheckVertical-stored records are queried. External eNaTIS/TransUnion/SAPS lookups are not connected. Query failures must show unavailable, never a clean result. |
| Report preview (score, price, areas, no notes) for non-purchaser | buyer | DB |
| Create booking (price from server, unpaid) | buyer | DB |
| Pay booking via PayFast | buyer | Unit (signature) · **Manual: not run with real or sandbox PayFast** |
| ITN: correct / wrong amount / repeated / failed / forged | server | DB + Unit |
| Booking status screen (payment, accepted, en route, in progress, done) | buyer | Manual |
| Cancel before acceptance | buyer | DB |
| Go online (approved only) | inspector | DB |
| See paid jobs only; accept (race-safe) / decline | inspector | DB |
| En route / in progress | inspector | DB |
| Submit detailed report (server-priced, idempotent) | inspector | DB + client regression tests; new deferred SQL integrity trigger must be verified on staging for 115 unique checklist items, 12 unique areas, score consistency and safety-fault downgrade. |
| Photo upload under own inspection folder | inspector | DB (storage policy); camera/device Manual |
| Unlock resold report via PayFast | buyer | DB + Unit · **Manual PayFast** |
| Earnings shown from real purchases | both | DB (data) · Manual (UI) |
| Notifications | both | DB |
| Withdraw to bank | both | **Not built** (button explains this) |
| Live inspector GPS tracking | buyer | **Not built**; map must not invent inspector pins or ETAs. |
| Admin: sign in, approve / suspend inspector, cancel booking, record refund, audit log, read-only role | operator | DB (29 tests) · UI against mocked backend · **Manual against real Supabase** |
