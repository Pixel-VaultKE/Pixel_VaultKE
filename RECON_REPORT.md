# Elite Customs — Full Recon
Every finding below is traced to an exact file and line, with a real
repro path. Anything I didn't verify against actual code is explicitly
marked as such — not silently skipped, not padded with a guess dressed
up as a finding.

Scope covered this pass: `admin.html`'s render/refresh pipeline for
orders, payments, and inventory alerts, plus `index.js`'s `createOrder`
idempotency. NOT covered this pass: `worker.html` (unread), the `sales`
collection's walk-in POS flow, expenses/tasks/tips workflows, and the
full field-level write-validation audit of every collection in
`firestore.rules`'s Elite Customs section. Say the word and I go into
any of those with the same rigor.

---

## 🔴 REAL BUGS

### 1. Recording a payment doesn't refresh Revenue/Cash/M-PESA/Debt — this is very likely why your screenshot showed KSH 0 everywhere
**File:** `admin.html`, `receivePayment()`, lines ~4625–4664
**What happens:** After a successful payment write, the function calls
`renderOrders()` only. It never calls `computeExtraStats()` — the
function that recomputes and redraws Revenue, Profit, Cash, M-PESA, and
Outstanding Debt (that logic lives around line 2790–2825, inside the
render pass `computeExtraStats()` triggers).
**Compare:** `updateProductionStatus()` (line 5044) gets this right —
it calls `computeExtraStats()` after every status change. `receivePayment()`
sits right next to it and doesn't.
**Repro:** Record a payment on any order. Watch the top "TODAY" money
row. It won't move until you reload the page or trigger any other action
that happens to call `computeExtraStats()`.
**Why it matters:** This is exactly the pattern in the dashboard dump you
sent me — Revenue/Cash/M-PESA all KSH 0 while there's clearly order
activity. An owner staring at KSH 0 revenue after taking real payment
today is the single worst kind of dashboard bug — it's not wrong data,
it's stale data pretending to be current.
**Fix:** add `computeExtraStats();` in `receivePayment()`'s try block,
same place `updateProductionStatus()` already does it.

### 2. Ticking a checklist step doesn't re-render anything
**File:** `admin.html`, `toggleChecklistStep()`, lines 4025–4038
**What happens:** Writes `checklist` to Firestore, updates the local
in-memory copy, logs it — and calls zero render functions. Not even
`renderOrders()`.
**Why it matters:** Minor compared to #1, but same family of bug — the
UI can silently drift from what you just did until something else
happens to trigger a redraw.
**Fix:** add `renderOrders();` after the local state update.

### 3. The top-of-dashboard order counts and the "Pending Orders" widget can disagree — proven, not assumed
**File:** `admin.html` — `renderCommandCenter()` (defines `stageCounts`,
~line 2818) vs `renderOrders()` (defines `pending`, line 4046)
**The proof:** both count the exact same thing — `realOrders()` filtered
to `productionStatus === 'new'` — from the exact same `rawOrders` array,
with the exact same predicate. They should always be numerically
identical. They aren't guaranteed to be, because they're refreshed on
different triggers:
- `renderCommandCenter()` only runs from `loadDashboard()` (full page
  load), `togglePrivacyMode()`, and inside `computeExtraStats()`.
- `renderOrders()` runs on every search/filter keystroke, every single
  order mutation (delete, checklist, status change via #1's fix path),
  and inside `loadOrders()`.
Any window between those two triggers is a window where the same number
is shown two different ways on the same screen. Your pasted dashboard
(New: 0 up top, Pending Orders: 7 in the widget) is very likely exactly
this — the page loaded once, order activity happened after, and only
`renderOrders()`'s trigger caught it.
**Fix:** the honest one is architectural, not a patch — one single
`renderAll()` that both functions get called from together, every time,
so there's no such thing as "which one is stale" anymore. Patching
individual call sites (like #1 and #2 above) closes today's gaps but
the next new mutation function will reintroduce this same class of bug
unless the render calls are unified.

### 4. `createOrder` has no duplicate-submission protection
**File:** `index.js`, `createOrder`, confirmed by absence — grepped for
any uniqueness/idempotency check on `receiptNumber` or similar, found
none. `receiptNumber` (line 31) is accepted as a plain string and used
for display only, never checked against existing orders.
**Repro:** Double-tap "Place Order" before the button disables (a real
gap — `btn.disabled = true` in `customer.html` happens synchronously,
but a flaky connection triggering a client-side retry, or two rapid
taps registering before the first `await` resolves, both bypass it), or
just call `createOrder` twice with the same cart from devtools. Two
separate order documents get created, two receipt numbers issued, two
inventory deductions once either enters production.
**Severity:** real but not urgent — needs a genuinely bad network
moment or someone deliberately spamming the button, not a normal-use
trigger. Still, "same sale twice" was explicitly on your attack list,
and right now nothing stops it.
**Fix:** pass a client-generated idempotency key (e.g. a UUID made once
per form-load) into `createOrder`, and have it check
`orders.where('idempotencyKey', '==', key).limit(1)` before writing.

---

## 🟢 WORKING (traced, not assumed)

- **`updateProductionStatus()` correctly gates production behind
  payment.** Line 5054 — if a status change would move an order past
  "new" with `amountPaid <= 0`, it forces an explicit owner confirm
  dialog naming your actual 60% deposit policy, rather than silently
  allowing it. This is exactly the kind of self-aware guardrail that's
  easy to skip and you didn't.
- **`deleteOrder()` discloses its own blast radius before you commit to
  it.** Line 4260 — the confirm dialog explicitly says deletion will
  NOT restore reserved stock and tells you to use Cancel Order instead
  if you need that. Nothing silent here — the tradeoff is stated at the
  point of the dangerous action, not buried in a comment.
- **Inventory deduction genuinely guards against double-deduction.**
  Both `updateProductionStatus()` (line ~5065) and `receivePayment()`
  check `!o.inventoryDeducted` / `isFirstPayment` before calling
  `deductInventoryForOrder()` — an order that gets paid AND moved to
  production doesn't get its stock deducted twice, per the code
  comment explaining exactly this reasoning at the `receivePayment`
  call site.
- **Role changes take effect immediately, no stale-session gap.**
  `myRole()` (firestore.rules) reads the `workers/{uid}` document live
  on every rule evaluation — unlike Mother Engine's custom-claims
  pattern (which needs a token refresh), an Elite Customs admin
  demoted to worker loses admin-level write access on their very next
  write attempt, not on their next login. UI elements gated by
  `applyRoleGating()` may still visually show admin controls until a
  page refresh, but the rules — the actual enforcement — don't lag.
- **`customer.html`'s order write path is now correct** (from earlier
  this session) — routes through `createOrder`, which recomputes price
  server-side instead of trusting the browser. Still needs the real
  end-to-end test we haven't run yet, so this stays 🟢-on-code-review,
  not 🟢-on-proof.

---

## 🟡 MISSING / NEEDED (not bugs — gaps for where this is going)

- **No idempotency layer anywhere** — same root cause as 🔴#4, but
  worth naming as a systemic gap, not a one-off: nothing in this
  codebase currently protects any write path (orders, sales, payments)
  from a genuine double-submit under a bad network. Worth solving once,
  generally, rather than per-function.
- **No unified render pipeline** — same root cause as 🔴#3. As more
  tenant collections get added under Mother Engine, "which widget
  refreshes on which trigger" only gets harder to reason about by hand.
  This is worth fixing before it's 10 collections deep, not after.
- **M-PESA reconciliation** — doesn't exist yet (confirmed earlier this
  session, Daraja not integrated). When it lands, "M-PESA money doesn't
  match recorded sales" becomes checkable against real transaction
  callbacks; right now there's nothing to reconcile against.
- **`worker.html` unaudited** — I haven't traced this file at all this
  pass. If workers have any write path that bypasses the same
  discipline `admin.html` shows in the 🟢 section above, I don't know
  yet, one way or the other.

---

## ⚫ DANGEROUS / WEAK (needs a decision, not just a fix)

- **A malicious or compromised staff account can edit an order's total
  after creation with weaker validation than creation gets.** The
  `orders` `update` rule only enforces the items/total shape check when
  `items`/`total` are among the changed fields — it doesn't re-validate
  `loyaltyDiscountAmount`, `subtotalBeforeDiscount`, or other pricing
  fields on update the way `createOrder` now validates on create. Scoped
  to `isStaff()` only (not public), so this is an insider-risk finding,
  not an open door — but worth naming since "what if a worker cheats
  the system" was explicitly on your list.
- **`bulkDeleteTestOrders()` (line 4279) is a real, permanent,
  multi-document delete gated only by a `confirm()` dialog** — no
  server-side check limiting it to actually-test-flagged data beyond
  the client-side filter (`r.data.isTestData`) before the batch delete
  is built. If `isTestData` were ever set incorrectly on a real order
  (manual data entry mistake, a future import bug), this button deletes
  it permanently, batched with whatever else got flagged. Worth a
  server-side safeguard eventually, not urgent today.

---

## What I'd actually fix first if I were you
🔴#1 (payment doesn't refresh money figures) is the one with real
consequences right now — it's the direct explanation for the exact
screenshot you sent me. Say go and I'll patch `receivePayment()`,
`toggleChecklistStep()`, and — if you want the real fix instead of the
patch — sketch the unified `renderAll()` that makes this whole bug class
stop being possible instead of playing whack-a-mole with it one function
at a time.
