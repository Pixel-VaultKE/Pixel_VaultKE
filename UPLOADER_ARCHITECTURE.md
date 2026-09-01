# Uploader Workforce System — Audit + Architecture
No UI built yet, per your order. This is the map before the machine.

---

## PART 1 — AUDIT: what exists, what's reusable, what's not

### Reusable as-is
**The auth-gating pattern** (`admin.html`, `auth.onAuthStateChanged`,
~line 1521). Login → look up a Firestore doc keyed by `uid` → check
`role` field → check `active !== false` → gate the UI. This is a solid,
proven shape. The uploader workspace should use the exact same
structure, pointed at a new `uploaders/{uid}` collection instead of
`workers/{uid}`.

**The immutable-audit-trail pattern** (`firestore.rules`, `movements`
and `events` collections — `allow update, delete: if false`). This is
exactly what submission records and earnings need. Already proven
correct in this codebase; reuse the shape, not just the idea.

**The role-check-happens-live pattern** (`isActiveAccount()`,
`firestore.rules`). Reading the status field fresh on every rule
evaluation, instead of trusting a cached custom claim, is why a
demoted/deactivated Elite Customs admin loses access immediately
instead of waiting for a token refresh. The uploader system needs this
exact property — "can a revoked worker keep uploading" is on your
attack list, and this pattern is the answer, already proven working
elsewhere in this codebase.

### NOT safely reusable — this is the important one
**The existing image-upload pattern is architecturally wrong for a paid
system.** `customer.html`'s `uploadArtwork()` (line 276) uploads
straight to Cloudinary using an **unsigned upload preset** — a preset
name embedded in client-side JS, visible to anyone who views source.
There's no authentication on the upload itself, no server-side record
of who uploaded what, and nothing stopping someone from hitting that
Cloudinary endpoint directly, outside your app entirely, with any image
they want.

That's an acceptable risk for "customer attaches a design to their own
order" — worst case, someone spams your Cloudinary storage. It is
**not** acceptable for "person gets paid KSh 1.65 per accepted image,"
because the entire chain of trust — who uploaded it, when, which
assignment it belongs to — currently only exists if the client
*chooses* to tell Firestore the truth after uploading. Your own list
asked "can someone submit directly to Firestore without going through
the UI" — with this pattern, yes, trivially, and there'd be no way to
tell the difference between a real upload and a forged record pointing
at someone else's Cloudinary URL.

**No Firebase Storage rules exist anywhere in what's been uploaded to
me.** Not a gap in what I've read — genuinely absent. If uploads move
to Firebase Storage instead of Cloudinary, that's a whole security
surface that doesn't exist yet.

**Nothing like earnings, rate history, or a review pipeline exists
anywhere in this codebase.** This part is fully new — no precedent to
reuse or avoid, just needs building correctly from scratch.

---

## PART 2 — ARCHITECTURE

### Core principle, stated once so every piece below follows it:
**Every field that determines money, role, or approval status is
written exclusively by a Cloud Function running under the Admin SDK —
never directly by a client write, regardless of role.** The client's
job everywhere in this system is to *propose* ("here's a picture, here's
an application") — never to *assert* a truth about itself ("I'm
approved," "this earned me money," "I'm uploader #4"). This is the same
principle `createOrder` already proved out for pricing — same
principle, new domain.

### Collections

**`uploadApplications/{applicationId}`**
`applicantName, phone, email, whyInterested, status, submittedAt,
reviewedBy, reviewedAt, reviewNotes`
- Create: public (this is the recruitment link), but `status` must be
  forced to `'pending'` by the rule itself — same shape as the existing
  `reviews` collection rule, which already forces `approved == false`
  on create. An applicant cannot submit themselves pre-approved.
- Read: admin only. Applicants never see other applications — no
  precedent needed here, this is just least-privilege.
- Update: admin only (status, reviewedBy, reviewedAt, reviewNotes).
- No client-side "am I approved" read on this doc at all — that
  question gets answered by whether an `uploaders/{uid}` doc exists for
  them, not by reading their own application's status directly.

**`uploaders/{uploaderId}`** — created ONLY by a Cloud Function
`name, phone, email, applicationId, status ('active'|'suspended'|'removed'),
authUid, joinedAt, totalAccepted, totalRejected, totalEarned`
- Write: `if false` for clients, full stop — same discipline as
  `platformOperators` and Mother Engine's `workers` subcollection.
  `totalAccepted`/`totalEarned` are denormalized caches maintained
  exclusively by the review Cloud Function, transactionally.
- Read: the uploader reads their own doc; admin reads any.

**`assignments/{assignmentId}`**
`uploaderId, description, targetCount, assignedAt, assignedBy, status`
- Write: admin/Cloud-Function only.
- Read: the assigned uploader reads their own; admin reads all.

**`submissions/{submissionId}`** — one per uploaded picture
`uploaderId, assignmentId, imageUrl, imageHash, submittedAt, status
('pending_review'|'accepted'|'rejected'), reviewedBy, reviewedAt,
rejectionReason`
- Create: the uploader, but `uploaderId` must equal their own server-
  issued identity (see Cloud Functions below — never a client-typed
  field), and `status` is forced to `'pending_review'` on create, same
  forcing-pattern as the applications collection. An uploader **cannot**
  write `status: 'accepted'` into existence, ever, by rule.
- Update: `if false` for the uploader — a rejected submission cannot be
  edited into an accepted one, and re-upload after rejection creates a
  **new** submission record rather than mutating the old one. This
  keeps the full history intact — every attempt stays visible, nothing
  gets overwritten.
- Delete: `if false` for everyone, including the owner. If a submission
  needs correcting, that's a new record, not an erasure — same
  reasoning as the existing `movements` collection.

**`earningsLedger/{entryId}`** — append-only, one entry per accepted
picture
`uploaderId, submissionId, rateApplied, amount, createdAt`
- Write: Cloud Function only.
- `rateApplied` is captured **at the moment of acceptance**, not looked
  up live — this is what makes "if I change the rate later, historical
  earnings don't mutate" actually true, rather than just a policy you
  have to remember to honor by hand.

**`settings/uploaderRate`** — current rate, admin-write-only, read by
the review Cloud Function when stamping `rateApplied` onto a new ledger
entry.

### Cloud Functions (Admin SDK — same pattern as `createOrder`)

- **`reviewApplication({applicationId, decision, notes})`** — admin
  only, re-checked server-side via the caller's own role, never a
  client-sent flag. On approve: creates the Firebase Auth account,
  creates `uploaders/{uploaderId}`, sets a custom claim linking that
  auth account to that uploader identity. **This is the only path an
  uploader identity can ever be created through** — directly answers
  "the client does not decide their own role."

- **`submitPicture({assignmentId, imageUrl, imageHash})`** — the
  uploader's `uploaderId` is read from their own custom claim
  server-side, never from what they typed. Before creating the
  `pending_review` record, checks `imageHash` against existing
  submissions for that assignment — genuine duplicate-image rejection,
  something a Firestore rule alone can't do (rules can't hash-compare
  against a collection of other documents). This is also where a
  signed-upload flow belongs if uploads move off Cloudinary's unsigned
  preset — the function issues a short-lived signed upload URL, the
  client uploads directly to storage with it, then calls this function
  to register the result. That closes the "submit directly to
  Firestore, bypassing the UI" hole for good, because the record can't
  exist without a signature this function issued.

- **`reviewSubmission({submissionId, decision, reason})`** — admin
  only. On accept: inside a Firestore **transaction** (not a plain
  write — this is what stops two near-simultaneous accept clicks from
  double-generating earnings on the same submission, your "racing two
  submissions at once" question), writes the ledger entry, increments
  `uploaders/{id}.totalAccepted`/`.totalEarned`. On reject: records the
  reason, generates nothing.

- **`setUploaderRate({newRate})`** — admin only, writes `settings/uploaderRate`.
  Never touches existing ledger entries.

- **`suspendUploader` / `removeUploader`** — flips `uploaders/{id}.status`.
  Combined with a live status check in the rules (same shape as
  `isActiveAccount()`), this takes effect on the revoked person's very
  next write attempt — not on their next login.

---

## PART 3 — YOUR ATTACK LIST, ANSWERED ONE BY ONE

| Attack | Where it's stopped |
|---|---|
| Change `workerId`/`uploaderId` on a submission | Rule requires it match the caller's own server-issued claim, never the client-typed field |
| Change role | `uploaders` collection is `write: if false` — only `reviewApplication` can ever create one |
| Change approval status | `uploadApplications` update restricted to admin; `submissions` update is `if false` for the uploader entirely |
| Change the rate | `settings/uploaderRate` is admin-write-only; existing ledger entries already have `rateApplied` baked in and are never touched |
| Change earnings | `earningsLedger` is Cloud-Function-only, append-only, no client write path exists at all |
| Submit as another uploader | Same as the `uploaderId` forgery answer — server-issued claim, not client-asserted |
| Approve your own work | `submissions` update — including status — is `if false` for the uploader, full stop |
| Pay yourself | Same as "change earnings" |
| Upload the same picture repeatedly | `imageHash` check inside `submitPicture`, before the record is even created |
| Bypass a rejection | Resubmission creates a new record; the old rejected one is `if false` on update, unchangeable |
| Read another uploader's submissions | Rule scopes read to `uploaderId == caller's own claim`; admin reads all |
| Reach admin-only records | `uploadApplications` read, `uploaders` write, `earningsLedger` write — all admin/Cloud-Function-gated, no exceptions |
| Delete evidence | `submissions`/`earningsLedger` are `delete: if false` for everyone, including you |
| Race two submissions/accepts at once | `reviewSubmission` uses a transaction, not a plain write |
| A revoked uploader keeps working | Live status check in rules (`isActiveAccount()` pattern) — takes effect immediately, not on next login |
| Two uploaders get the same assignment by accident | Operational/workflow concern, not a security hole — worth a soft guard in the assignment-creation function, lower priority than the money/identity items above |
| Uploader disappears mid-batch | Not a security question — assignment stays `in_progress`, partial submissions are already permanently recorded either way, admin reassigns the rest |
| Garbage submissions | Normal reject path — recorded with a reason, generates no earnings, breaks nothing |

---

## What I need from you before "build" actually starts writing code
1. **Where do images actually live** — staying on Cloudinary (fine, but
   needs the signed-upload variant described above, not the current
   unsigned one) or moving to Firebase Storage (needs Storage Security
   Rules written from scratch, since none exist)? This changes real
   implementation details, not just the plan.
2. Is this staying **root-level** (matching Elite Customs' current
   un-migrated collections) or should it be built **already under
   `businesses/{businessId}/`** even before Elite Customs itself
   migrates? I'd lean root-level for now, matching everything else that
   hasn't migrated yet — but that's a call about sequencing the bigger
   migration, not a security one, so it's yours to make.

Say go and I start with `submitPicture` + the `imageHash` duplicate
check first — that's the one piece with no existing precedent anywhere
in this codebase to model against, so it's the part most worth getting
review on before the rest gets built around it.
