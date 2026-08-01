# Holiday Rental Management System — Phase 1 (Core)

Phase 1 of the system defined in `Doc_Spec/Holiday_Rental_System_Specification.docx` and
`Doc_Spec/Implementation_Plan.docx`: properties, guests, bookings (with double-booking
prevention), DET permit / document compliance tracking, utility accounts, iCal export,
and role-based access control.

## Running it

```bash
npm install
npm run seed   # creates owner@example.com / changeme123
npm run dev    # http://localhost:3000
```

No external database, Docker, or account setup is required for local development — see
"Database" below.

Run the automated test suite:

```bash
npm run test        # 76 tests, all passing
npm run typecheck
npm run build        # production build
```

## Deviations from the Implementation Plan

The plan named Prisma, Supabase Postgres, and Supabase Auth specifically. All three were
substituted in this build because the sandbox this was built in has no outbound access to
`binaries.prisma.sh`, no Docker/Postgres/sudo, and no live Supabase project to connect to.
The substitutions are functionally equivalent and isolated to a small number of files, so
swapping in the originally-planned services later is a contained change, not a rewrite.

| Planned | Built instead | Why | Where |
|---|---|---|---|
| Prisma ORM | Drizzle ORM | Prisma's engine binaries couldn't be downloaded in this environment | `db/schema.ts`, `db/client.ts` |
| Supabase Postgres | PGlite (embedded, WASM-compiled real Postgres) for dev/test; real Postgres via `pg` when `DATABASE_URL` is set | No Postgres server or Docker available; PGlite runs identical SQL (including the `daterange` + GiST exclusion constraint that prevents double-booking) with zero setup | `db/client.ts` |
| Supabase Auth + Row-Level Security | Custom email/password login with bcrypt + HMAC-signed session cookies; RBAC enforced in the application layer (`lib/authz.ts`) instead of in Postgres RLS policies | No Supabase project reachable | `lib/session.ts`, `lib/services/authService.ts`, `lib/authz.ts` |

**To move to production with the originally-planned stack:** point `DATABASE_URL` at a
Supabase (or any) Postgres instance — `db/client.ts` switches to the real `pg` driver
automatically when that variable is set, no code changes needed. Run
`npm run migrate` to apply `db/migrations/0001_init.sql` against it. Supabase Auth and RLS
can then replace the custom session/RBAC layer as a follow-up; the `CurrentUser`/`Role`
shape in `lib/authz.ts` was kept simple specifically so that swap is mechanical.

Everything else — the data model, the booking state machine, the DET compliance rules
(permit expiry traffic-light, booking-block-until-resolved with owner override, the
auto-created guest-registration task), and the UI — was built exactly as specified.

## What was tested

- **76 automated tests** (`npm run test`) covering: property CRUD, document/compliance
  traffic-light logic, guest CRUD, booking overlap prevention at the database constraint
  level, the full booking status state machine, RBAC policy for every role, iCal export,
  utility accounts, and calendar-grid date handling — all passing, 0 failures.
- **Manual end-to-end verification** against a real `next build && next start` production
  server (not just the dev/test harness), confirming: login (valid and invalid
  credentials), property/guest/booking creation, a booking correctly blocked from
  confirming while the property's DET permit is missing, the block clearing once a permit
  document is added, the `guest_registration` compliance task being auto-created on
  confirmation (verified directly in the database), the compliance dashboard, the iCal
  feed producing valid `.ics` output, RBAC being enforced *server-side* (a housekeeping
  user's direct POST to the property-creation action — not just the hidden button — was
  rejected), and double-booking prevention (a second, overlapping booking can be logged as
  an enquiry but is rejected at confirmation with "these dates are no longer available").

This second pass caught one real bug that the unit tests alone could not have: webpack's
default bundling broke PGlite's runtime loading of its Postgres extensions when running
inside the compiled Next.js server (`Extension bundle not found`). Fixed in
`next.config.mjs` via `experimental.serverComponentsExternalPackages`; see the comment
there for detail. This only affects the embedded PGlite path — a real Postgres connection
in production never touches it.

## Known residual issue

`npm audit` reports 2 remaining high-severity advisories against Next.js/postcss that are
only fixed in Next.js 16. Upgrading was deliberately deferred — it's a major-version jump
beyond Phase 1 scope and not needed for the app to function correctly. Worth scheduling
before production launch.

## Project layout

```
db/               Drizzle schema, migration SQL, client (PGlite for dev/test, pg for prod), seed script
lib/authz.ts       Role-based access policy
lib/session.ts     Signed-cookie session helpers
lib/services/      Domain logic: property, document/compliance, guest, booking, utility, audit, auth
lib/__tests__/     Vitest suite (76 tests)
app/               Next.js App Router pages + Server Actions (properties, guests, bookings, compliance, login)
app/api/ical/[id]  iCal export route
```
