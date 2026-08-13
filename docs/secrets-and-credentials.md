# Secrets and credentials

**No secret values appear in this document or anywhere in `/docs`.** This is an
inventory of what exists, where it lives, and what it is for.

## Backend / platform secrets

| Name | Scope | Purpose | Notes |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | browser + server | Database/API endpoint | Not a secret; ships in the client bundle |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | Data API key for the browser client | Publishable by design; safe to expose, RLS is the real control |
| `VITE_SUPABASE_PROJECT_ID` | browser | Project reference | Not a secret |
| `SUPABASE_URL` | server only | Same endpoint for server functions | — |
| `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` | server only | Publishable key for server-side reads and the auth middleware | — |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | **Bypasses RLS.** Used only by `src/lib/integrations.functions.ts` for `integration_credentials` and `integration_events` | Never expose to the browser, never prefix with `VITE_` |
| `SUPABASE_DB_URL` | server only | Direct Postgres connection string | Platform-managed |
| `LOVABLE_API_KEY` | server only | Lovable AI gateway key | Present in the environment; **no application code currently calls it** |

On the production deployment these are injected by the hosting platform. The
service-role key and the database password are **not retrievable** by the project
owner or by a reviewer — a reviewer must use their own Supabase project and their
own keys. Rotation of the platform keys happens at the platform level.

## Auth

- Provider: Supabase Auth, email + password only.
- No social/OAuth provider is configured, so there are no OAuth client IDs or
  secrets for sign-in.
- Sign-up is invite-only; user creation is an admin action.
- Sessions are stored in browser `localStorage` by the Supabase client.
- JWT signing keys are platform-managed.

## Third-party integration credentials

These are **entered by staff in Settings → Integrations at runtime**, not
configured as deploy-time environment variables. They are stored as JSONB in
`public.integration_credentials`, one row per provider.

| Provider | Field the UI treats as primary | Purpose |
| --- | --- | --- |
| Donorbox | `api_key` | pull online donations |
| Stripe | `secret_key` | card processing |
| Constant Contact | `client_secret` (OAuth) | two-way email/consent sync |
| WordPress | `webhook_secret` | inbound website forms |
| Cognito Forms | `webhook_secret` | inbound registrations |
| QuickBooks | `client_secret` (OAuth) | bookkeeping export |
| Google Sheets | `webhook_secret` | spreadsheet exchange |

Handling, and its problems:

- `integration_credentials` has RLS **enabled with no policies**, so PostgREST
  cannot read it at all. Only the service-role server functions can — correct.
- The browser never receives a full credential. The status endpoint returns
  existence plus a masked last-4 hint only.
- **Values are stored in plaintext JSONB** — no Vault, pgsodium, or KMS envelope
  encryption. A database backup or a leaked service-role key is a full credential
  compromise. This is the single most important security item to fix before any
  real provider key is entered. See `known-issues.md` item 3.
- `integration_events` records connection-test outcomes and messages; it is
  service-role-only for the same reason. Confirm that no provider error message
  written there can echo a key.

## What a reviewer needs, and what they must not be given

Needs: GitHub repository access, their own Supabase project (URL + publishable
key + service-role key), and a sample CSV or two.

Must not be given: the production service-role key, the production database
password or connection string, or any live Donorbox/Stripe/Constant
Contact/QuickBooks credential. Nothing in the audit requires production data —
if production-shaped data is needed, export a sample and scrub names, emails,
phone numbers and gift amounts first. The database contains donor PII and giving
history for a real community.
