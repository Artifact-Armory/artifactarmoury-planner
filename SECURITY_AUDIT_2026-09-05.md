# Artifact Armoury — Security Audit
**Date:** 2026-09-05 · **Scope:** full backend (`backend/src`) + relevant frontend, live production architecture as described in `CLAUDE.md`
**Status: all 7 findings fixed in the working tree same day** (migration 060 required — see bottom of this file).
**Method:** 5 parallel research passes (auth/authz, entitlement/R2/watermark, injection, payments/promo/refunds, CORS/secrets/uploads), every finding below re-verified line-by-line against the current source before inclusion. Only findings I'm highly confident (≥8/10) are real and exploitable are listed. Diff currently pending on `main` (the `/sets` grouping fix + `FULL_GLB_MAX_TRIS` bump) was reviewed separately and is **clean** — parameterized queries throughout, no new attack surface.

---

## 🔴 HIGH — Order confirmation can be forged to unlock any order for free
**File:** [backend/src/routes/orders.ts:473](backend/src/routes/orders.ts:473) (`POST /api/orders/:id/confirm`)

The route has **no `authenticate` middleware at all** (contrast with the other order routes at lines 617/649/765, which all require it), and it never checks that the `paymentIntentId` sent in the body actually belongs to the order `:id` in the URL — no comparison to `order.payment_intent_id` (the value stamped on the order at creation, line 432) and no comparison to `payment.amount`/`payment.metadata.order_id`. It only checks that *some* PaymentIntent, fetched fresh from Stripe by whatever id the client sends, has `status === 'succeeded'`, then claims the order row.

**Exploit:** Buy something cheap (£0.50) for real → get a genuine `succeeded` PaymentIntent id. Create a second order for an expensive model/bundle and never pay. Call `POST /api/orders/<expensive-order-id>/confirm` with `{"paymentIntentId": "<the cheap one>"}`. The server marks the expensive order paid + delivered, unlocks the download, and accrues real artist earnings — for a sale that was never charged. Because the route is unauthenticated, this is also reachable against *other buyers'* pending orders if the order id leaks (e.g. a shared confirmation-page URL).

**Fix:** require `authenticate` and check `order.user_id === req.userId` (or guest-order equivalent); verify `payment.metadata.order_id === id` and `payment.amount` matches `order.total` before claiming the order; consider marking a PaymentIntent as consumed after one successful claim.

---

## 🔴 HIGH — Promo code scope isn't enforced on the real checkout path
**File:** [backend/src/routes/orders.ts:273](backend/src/routes/orders.ts:273), compare [backend/src/services/promoCodes.ts:68](backend/src/services/promoCodes.ts:68) and [backend/src/routes/promoCodes.ts:203](backend/src/routes/promoCodes.ts:203)

`codeAppliesToModel(code, modelId, artistId)` restricts a `model`-scoped code to its one target model and a `portfolio`-scoped code to its one artist's models. `POST /api/promo-codes/validate` (the checkout *preview*) correctly calls it. `POST /api/orders` (the *actual charge*) never does — it resolves the code once (`findActiveCode`, which only checks active/in-window) and then calls `promoApplier.apply(price)` against **every standalone model line in the cart, from any artist**, with no scope check at all.

**Exploit:** Artist A issues a private 95%-off code scoped to one of their own cheap models. Anyone who obtains that code string can apply it at checkout against a cart containing an expensive model from Artist B (or several artists) and get it 95% off. Since the discount is deliberately taken entirely out of the artist's commission share (by design, per the code's own comments), this directly transfers money away from artists who never authorized any discount.

**Fix:** call `codeAppliesToModel(promoCode, model.id, model.artist_id)` before `promoApplier.apply(price)` in the per-item loop in `orders.ts`, exactly as `promoCodes.ts` already does.

---

## 🔴 HIGH — Raw R2 keys for the owner-tier GLB and pre-supported preview STL are leaked to clients
**Files:** [backend/src/routes/models.ts:1364-1367](backend/src/routes/models.ts:1364) (`GET /api/models/:id`), [backend/src/routes/orders.ts:686-688](backend/src/routes/orders.ts:686) (`GET /api/orders/library`)

Both routes `SELECT m.*` and then only strip `stl_file_path`, `glb_file_path`, and `source_file_path` before spreading the row into the JSON response. Neither strips **`full_glb_path`** (migration 041) or **`display_stl_path`** (migration 053/054) — both of which the code's own comments describe as deliberately unguessable (128-bit random suffix) and "never returned by any API," specifically *because* the R2 bucket is public through the CDN with no signed-URL requirement.

**Exploit:** `GET /api/models/<id>` (no auth needed, any published model) or `GET /api/orders/library` (any signed-in buyer, for a model they own) returns `full_glb_path`/`display_stl_path` in the JSON. Either is a plain, permanent, public CDN URL (`https://assets.artifactplanner.com/<that key>`) serving the full-fidelity, **un-watermarked** mesh (or, when set, an un-watermarked clean STL) — bypassing both the purchase requirement and the per-buyer watermark the entire anti-piracy pipeline is built around. This is the single most damaging finding: it undermines the feature the memory files describe as "PROVEN LIVE" and load-bearing for the whole seller-protection story.

**Fix:** add `delete model.full_glb_path; delete model.display_stl_path;` next to the existing three deletes in both routes (and audit any other `SELECT m.*` response path — `routes/admin.ts:552` has the same gap but is admin-only so lower priority).

---

## 🔴 HIGH — Stored HTML injection via model name in the order-confirmation email
**File:** [backend/src/services/email.ts:347](backend/src/services/email.ts:347), fed by [backend/src/routes/orders.ts:584](backend/src/routes/orders.ts:584)

`sendOrderConfirmation()` interpolates `item.asset.name` (= `models.name`, a free-text field an artist fully controls when creating/editing a listing) directly into an HTML email with no escaping anywhere in the file.

**Exploit:** An artist names/renames a model to include `<img src=x onerror=...>` or a spoofed `<a href="https://phish...">` link. Every buyer of that model receives an order-confirmation email rendering that payload as live HTML in their mail client — a reliable phishing/UI-spoofing vector against strangers with no other relationship to that artist, and potential script execution in mail clients with weaker HTML sanitization.

**Fix:** HTML-escape `item.asset.name` (and any other artist/user-controlled string interpolated into an email template) before building the HTML string — a simple `escapeHtml()` helper used consistently across `email.ts`.

---

## 🟡 MEDIUM — Same unescaped-HTML pattern in the public contact form's support-notification email
**File:** [backend/src/services/email.ts:665,673,677](backend/src/services/email.ts:665)

`POST /api/contact` is fully unauthenticated (`optionalAuth`). `sendContactMessageToSupport()` interpolates `name`, `subject`, and `message` straight into the internal support-notification email's HTML with no escaping.

**Exploit:** Anyone, signed in or not, submits the contact form with HTML/link payloads in the message body; the internal support inbox renders it as live HTML — phishing risk against your own support staff, zero prerequisites.

**Fix:** same `escapeHtml()` fix as above, applied to `name`/`subject`/`message` in both `sendContactMessageToSupport` and `sendContactConfirmation`.

---

## 🟡 MEDIUM — No session/token invalidation on password change, password reset, or 2FA disable
**Files:** [backend/src/middleware/auth.ts:56-87](backend/src/middleware/auth.ts:56) (JWT issuance — stateless, no version/`jti`), `routes/auth.ts` password-change/reset/2FA-disable handlers

Access tokens are 7-day JWTs and refresh tokens are 30-day, with no server-side revocation, token-version column, or blacklist anywhere in the codebase. None of the account-recovery flows (password change, password-reset confirm, 2FA disable) invalidate previously-issued tokens.

**Exploit:** If a token is ever compromised (XSS elsewhere, a leaked log, a shared device), the standard remediation — "change your password" — does not actually revoke the attacker's session. They keep full API access as that user for up to 7–30 days regardless.

**Fix:** add a `token_version` (or `password_changed_at`) claim/column checked in `authenticate`, bumped on password change/reset and 2FA disable.

---

## 🟡 MEDIUM — Hardcoded fallback JWT secret is a known public string
**Files:** [backend/src/middleware/auth.ts:56](backend/src/middleware/auth.ts:56), [backend/src/routes/auth.ts:36](backend/src/routes/auth.ts:36)

```
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
```
If `JWT_SECRET` is ever unset (a fresh preview/staging deploy, a misconfigured env), the app doesn't refuse to start — it just logs a warning and signs/verifies every token with this literal, which is sitting in the public GitHub repo. `CLAUDE.md` confirms `JWT_SECRET` is required on Railway for the live service, so production itself is very likely fine — but this is a live footgun for any staging/preview environment or local `DB_MOCK` deploy someone points at a real-ish setup.

**Fix:** fail fast (`throw`) at startup if `JWT_SECRET` is unset in any non-test environment, instead of falling back to a literal.

---

## Summary table

| # | Finding | Severity | File |
|---|---|---|---|
| 1 | Order-confirmation route unauthenticated + doesn't bind payment intent to order | HIGH | `orders.ts:473` |
| 2 | Promo code scope not enforced at real checkout | HIGH | `orders.ts:273` |
| 3 | Raw R2 owner-GLB/display-STL keys leaked in API responses | HIGH | `models.ts:1364`, `orders.ts:686` |
| 4 | Unescaped artist-controlled model name in order email | HIGH | `email.ts:347` |
| 5 | Unescaped contact-form input in support email | MEDIUM | `email.ts:665` |
| 6 | No token invalidation on password/2FA change | MEDIUM | `middleware/auth.ts` |
| 7 | Hardcoded fallback JWT secret | MEDIUM | `middleware/auth.ts:56` |

**Recommended order of fixing:** #3 (undermines the core anti-piracy feature right now, for every already-published model with an owner-GLB build), then #1 and #2 (both directly cost real money and are trivially reachable by any registered user), then #4/#5 (HTML-escape helper, one small shared fix), then #6/#7 as hardening.

None of these require a live Postgres to fix or test in isolation — #1, #2, #4, #5, #7 are all pure code changes verifiable by inspection; #3's fix is a two-line addition mirroring the pattern already used for the other three fields in the same routes; #6 needs a small migration (one column) plus the DB access this project doesn't have locally, so it's the one item worth verifying on a real deploy.

---

## Fixes applied (2026-09-05)

| # | Fix |
|---|---|
| 3 | Added `delete model.full_glb_path; delete model.display_stl_path;` to `GET /api/models/:id`, `GET /api/orders/library`, and (defense-in-depth) `GET /api/admin/models/:id`. |
| 1 | `POST /api/orders/:id/confirm` now requires `authenticate`, checks the caller owns the order (or is admin), and rejects unless `payment.metadata.order_id === id` — the same binding the webhook already trusted. The mock Stripe path (`STRIPE_MOCK=true`) now encodes the order id into its fake intent id too, so the check works identically in mock and live mode. |
| 2 | `POST /api/orders` now calls `codeAppliesToModel(promoCode, model.id, model.artist_id)` before discounting a line — exactly the same scope check `/validate` already did, now authoritative at the real charge too. |
| 4, 5 | Added a shared `escapeHtml()` in `services/email.ts`, applied to every artist/visitor-controlled string interpolated into an email template (order-confirmation item names, artist sale-notification item names, and all contact-form fields in both directions). |
| 6 | Migration 060 adds `users.tokens_valid_from`. `invalidateUserTokens()` (new, in `middleware/auth.ts`) is called from password change, password-reset confirm, and 2FA disable; `authenticate`/`optionalAuth`/`refreshAccessToken` all reject a token whose `iat` predates it. |
| 7 | `middleware/auth.ts` now throws at startup if `JWT_SECRET` is unset (any environment except `NODE_ENV=test`), instead of silently signing with a literal from the public repo. `routes/auth.ts` now imports the same constant instead of keeping its own independent fallback copy. |

**Still needed from you:** migration 060 needs to actually run against production Postgres — it ships via Railway's Pre-Deploy Command on the next push to `main`, same as every other migration in this project. Nothing else here needs a manual step.
