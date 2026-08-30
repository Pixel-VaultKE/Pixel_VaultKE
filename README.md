# Step 02 — Proving the tenant boundary

I have to be straight with you: I cannot run this myself. This sandbox
has no network access, so I can't download the Firestore emulator or
execute these tests. What's here is written carefully against Firebase's
own documented Rules Unit Testing API — but "I wrote it correctly" is not
the same as "Firestore actually rejected every unauthorized operation."
Only running it gets you that. Please run it and tell me what comes back
— pass or fail, I want to see the actual output.

## One-time setup
1. `npm install -g firebase-tools` (skip if you already did this for the
   Cloud Function deploy)
2. Java (JRE) must be installed — the Firestore emulator needs it. If you
   don't have it: `java -version` will tell you; if missing, install a
   JRE (e.g. Eclipse Temurin) before continuing.
3. `cd rules-tests && npm install`

## Run it
```
npm test
```
This starts a real, local Firestore emulator, loads your actual
`firestore.rules` file into it (not a copy, not a simulation of it — the
literal file one level up), runs every test in `tenant-boundary.test.js`
against it, then shuts the emulator down.

## What a real pass looks like
Every test is named for exactly what it's proving — you should see output
like:
```
✓ Business A member CAN read Business A products ✅
✓ Business B member CANNOT read Business A products ❌
✓ A forged businessId FIELD inside the document is rejected ❌
...
Tests: 24 passed, 24 total
```
`assertFails()` tests are the important ones — they only pass if Firestore
genuinely denied the operation with a permission error. If a `assertFails`
test fails, that means Firestore let something through it shouldn't have
— a live boundary hole, not a testing mistake.

## What's actually being tested
Every scenario from the Step 02 list, against the real `products`
collection rule:
- Business A → its own data ✅, Business B → its own data ✅
- A reading B, B reading A — both directions denied ❌
- A writing into B, B writing into A — both directions denied ❌
- A worker-role account (not owner) from A tried against B — denied,
  plus a sanity check that the same worker CAN still read their own
  business's data (role alone shouldn't accidentally block same-tenant
  access)
- Tenant vs. platform console, both directions — a tenant can't read the
  operator directory or edit their own business's registry entry; the
  operator CAN read/edit the registry, but (deliberately, see below)
  CANNOT read tenant product data
- Unauthenticated requests — denied on products, the registry, and the
  operator directory
- A forged `businessId` field inside a document that doesn't match the
  path it's stored under — rejected, with a companion test proving an
  honest matching field (and no field at all) still works normally
- No claim at all, a claim pointing at a business that doesn't exist, and
  a claim pointing at a suspended business — all denied
- A live-suspension test: a business is active, a member successfully
  reads their data, the business gets suspended mid-test with rules still
  live, and that SAME member is immediately denied on their next request
  — without their own claim ever being touched. This is the strongest
  proof that `businessIsActive()` is checked live, not just cached from
  login.

## One thing to notice, not just accept
There's a test called *"The platform operator alone... CANNOT read tenant
PRODUCT data — by design, not yet granted ❌"*. That's not a bug being
tested — it's a real, open decision. Right now a platform operator can
see the business registry (for oversight of the platform itself) but has
zero visibility into any tenant's actual products, orders, sales, etc.
That's the safe default, but at some point "Support / Oversight" (from
the original architecture doc) will need SOME level of operator access
into tenant data — and when that gets designed, it should be deliberate,
scoped, and probably logged/audited itself, not a blanket bypass. Flagging
it here so it surfaces again when you're ready to design it, not as a
surprise.

## After this passes
Once you've actually run this and it's green, that's Step 02 done —
proven, not assumed. Come back and I'll extend the exact same
`canAccessTenantData()` pattern to the next tenant collection, and we
start on the migration script (Step 03) only after that.
