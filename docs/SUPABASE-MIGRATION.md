# Migrating the database to Supabase

**Decided:** 12 August 2026 — Supabase as the **Postgres host only**. Auth stays
exactly as it is.
**Data:** starting fresh. No dump/restore.

This is a connection-string change plus a schema push. It is not a rewrite.

---

## Why this is low-risk

Unlike a move to Firebase, **Supabase is Postgres**. The code never had any
vendor coupling to begin with:

- `lib/db/src/index.ts` uses the standard `pg` driver via
  `drizzle-orm/node-postgres` — no `@neondatabase/serverless`, no vendor SDK
- the schema is plain Postgres — `uuid`, `timestamptz`, `jsonb`, `date`
- every query goes through Drizzle
- nothing in `artifacts/api-server/src` mentions the provider

So: Drizzle, the schema, all four migrations, every repository, and all 295 tests
port unchanged. The only things that move are `DATABASE_URL` and the TLS setup.

**What is explicitly not changing:** bcrypt cost 12, account lockout, progressive
delay, non-enumeration, timing equalisation, session revocation, legacy-hash
migration, and the age gate. Supabase Auth would replace all of that, which is
why it was kept separate — see `docs/FIREBASE-ASSESSMENT.md` for the same
reasoning applied to Firebase.

---

## ⚠️ Read this before you run anything

**Do not run the numbered `.sql` files against a fresh Supabase database.**

They are *incremental*. `0001` starts with `ALTER TABLE users`, and on an empty
database there is no `users` table to alter — it will fail on the first
statement.

Those files exist to upgrade the **existing Neon** database in place. For a new
database, `schema/index.ts` is the source of truth and already contains
everything the four migrations add, including `sessions_valid_after` (0003) and
`birth_date` (0004). One `drizzle-kit push` produces the complete, correct
schema.

| Situation | Do this |
|---|---|
| **New Supabase project (you are here)** | `drizzle-kit push` |
| Upgrading the old Neon database | Run `0001`–`0004` in order |

---

## 1. Create the project

Supabase → New project. Choose a region close to where the API will run — a
cross-continent hop adds latency to every query, and this API is chatty.

**Save the database password when it is shown.** It is displayed once. Put it
straight into your password manager.

---

## 2. Get the right connection string

Supabase offers three, and the difference matters. Project Settings → Database →
Connection string. Copy from the dashboard rather than assembling one by hand;
the formats change.

| Mode | Port | Use it? |
|---|---|---|
| **Direct connection** | 5432 | Only if your host has IPv6. Railway's support has varied — do not assume. |
| **Session pooler** | 5432 (via `pooler.supabase.com`) | ✅ **Use this.** IPv4, and it behaves like a normal Postgres connection. |
| **Transaction pooler** | 6543 | Fine for serverless, but it is PgBouncer in transaction mode: no prepared statements, no session state. Avoid for a long-running server. |

**Pick the session pooler.** The API is a persistent Node process holding a
connection pool — exactly what session mode is for. Transaction mode is designed
for the opposite shape (many short-lived serverless invocations) and will bite
you the first time Drizzle prepares a statement.

Set it:

```bash
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

---

## 3. TLS

Supabase requires TLS, and this database holds password hashes and reset tokens.

`lib/db/src/index.ts` keeps certificate verification **on**. If you hit:

```
Error: self-signed certificate in certificate chain
```

the fix is **not** `rejectUnauthorized: false` — that keeps the encryption and
throws away the authentication, which leaves you open to exactly the
man-in-the-middle TLS exists to stop. It is the single most common piece of bad
advice about this error.

Instead, download the CA certificate (Project Settings → Database → SSL
Configuration) and set it:

```bash
DATABASE_CA_CERT="$(cat prod-ca-2021.crt)"
```

The code accepts the PEM directly and handles `\n`-escaped newlines, so it
survives being pasted into a Railway variable.

---

## 4. Create the schema

From the repo root, with `DATABASE_URL` pointing at Supabase:

```bash
pnpm --filter @workspace/db run push
```

`drizzle-kit` diffs `schema/index.ts` against the empty database and creates
everything: `users`, `athlete_profiles`, `analyses`, `coaching_tips`,
`injury_risks`, `subscriptions`, `chat_messages`, `password_reset_tokens`,
`achievements`, and the enums.

It will print the statements and ask for confirmation. **Read them.** You are
looking for `CREATE TABLE` only — any `DROP` means it is pointed at the wrong
database.

### Then add the read-path indexes

`push` creates the schema but not the composite indexes from migration `0002`,
which are hand-written rather than declared in the Drizzle schema. Paste
`lib/db/migrations/0002_read_path_indexes.sql` into the Supabase SQL editor and
run it. Every statement is `IF NOT EXISTS`, so it is safe to run twice.

Skip this and the app still works — it just does sequential scans on the quota
count that runs before every upload.

---

## 5. Verify

```bash
pnpm --filter @workspace/api-server test
```

295 should pass. They use an in-memory fake, so this proves the code is intact,
not the connection.

For the connection itself, boot the server:

```bash
pnpm --filter @workspace/api-server run dev
```

Then exercise a real write path end to end — this is the check that matters,
because it touches TLS, the pooler, the schema, and the age gate at once:

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"a-long-test-password","name":"Test","dateOfBirth":"1995-06-15"}'
```

A token back means the whole path works. Then confirm the age gate is live:

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"kid@example.com","password":"a-long-test-password","name":"Kid","dateOfBirth":"2017-01-01"}'
```

That must return 400.

In the Supabase table editor, confirm the row landed in `users` with
`password_algo = 'bcrypt'`, a `birth_date`, and a `password_hash` starting
`$2a$12$` or `$2b$12$`. **If you can read the password, stop** — but you cannot,
because it is bcrypt.

---

## 6. Update the deploy

Railway → Variables → set `DATABASE_URL` and, if needed, `DATABASE_CA_CERT`.
Redeploy.

```bash
curl -s https://<host>/api/health/metrics | jq '.status'
```

---

## 7. Afterwards

- [ ] **Delete the Neon project** once you are satisfied — an abandoned database
      with real credentials is a liability, and the old password was never
      rotated (`TODO-PRODUCTION.md` §1.4). Deleting it closes that item outright.
- [ ] **Update the privacy policy** processor table — it lists the database
      provider by name (`docs/PRIVACY-POLICY.md` §5).
- [ ] **Sign Supabase's DPA** if you have EU users (`docs/LEGAL-RISK.md` §7).
- [ ] **Turn on Point-in-Time Recovery** if you ever hold real user data. The
      free tier's daily backup means up to 24 hours lost.
- [ ] **Row Level Security.** Supabase enables RLS prompting because its usual
      model is clients talking to Postgres directly. **Yours do not** — every
      query goes through the API, which enforces ownership in the repository
      layer (`findAnalysisById` takes a `userId` and there is deliberately no
      overload without one). So RLS is not load-bearing here. Leave the service
      key server-side and never ship an anon key that can reach these tables,
      and the property holds.

---

## If you later want Supabase Auth

Keep it a separate, deliberate project. It would replace the auth layer this
codebase has invested most in — read `docs/SECURITY.md` against Supabase's own
guarantees before deciding, rather than assuming a managed service is
automatically stronger. Firebase Auth was assessed the same way in
`docs/FIREBASE-ASSESSMENT.md`; the reasoning transfers.
