# Elite Customs — UI/UX Blueprint
Everything below is grounded in files actually read this session:
`index.html`, `customer.html`, `admin.html`, `worker.html`, `apply.html`.
Nothing invented. No code in this document — per the stop condition,
this is the blueprint, waiting for approval.

---

## 01 — Current Experience Map

Five standalone pages, no shared shell:

- **`index.html`** — public landing. Two of six intended sections exist
  (Hero, What We Customize). Gallery and Reviews are present but
  conditional/hidden-if-empty. No "How It Works," no "Why Us," no
  closing CTA.
- **`customer.html`** — catalog + order form, all on one continuous
  scroll. Featured services, gallery, reviews, catalog search, and the
  order form are separate cards with no transition between "looking" and
  "buying."
- **`admin.html`** — 27 collapsible cards, one scroll, no navigation.
  The cards already carry real grouping labels as plain section
  dividers (Priority, Overview, Money & Operations, Team, Stock &
  Catalog, Customers & Marketing) — the grouping logic already exists,
  it's just never been turned into actual navigation.
- **`worker.html`** — same shape as `admin.html` (collapsible cards, no
  nav), fewer sections, but visually presented with the same density as
  the owner's tool despite being a fundamentally simpler job.
- **`apply.html`** — the one page already given real structure tonight
  (two-column responsive layout). Smallest gap of the five.

---

## 02 — Design Philosophy

Better decisions, not more design. Concretely:

- A page announces what it is and what matters most on it within one
  glance — not by shouting, by placement and weight.
- Every visual element earns its place. No card exists because
  "everything else is a card too."
- Calm by default; intensity (color, size, motion) reserved for what's
  actually urgent or actionable.
- The brand's existing identity (ink/hot/volt/gold, Bebas Neue) stays —
  the goal is giving it structure to live in, not replacing it.

---

## 03 — Complete Design System

**Typography** — four roles, not two:
- *Display* (Bebas Neue) — page-level identity, used once per page.
- *Heading* (Bebas Neue, smaller) — section titles.
- *Body* (Inter, 400/600) — everything read at length.
- *Caption* (Inter, 600, smaller, muted) — labels, metadata, timestamps.

**Color** — existing tokens, assigned actual semantic meaning instead of
being used interchangeably:
- `--volt` → money/success/positive state, exclusively.
- `--hot` → urgent/needs-attention, exclusively.
- `--sky` → informational/neutral action.
- `--gold` → premium/settings/configuration.
- No accent used decoratively where it doesn't carry one of these meanings.

**Spacing** — one scale: 4 / 8 / 12 / 16 / 24 / 32 / 48px. Every inline
`style="margin:..."` value currently scattered through the markup maps
to one of these seven numbers, no in-between values.

**Elevation** — three tiers: flat (low-priority/background info), raised
(the current default card treatment from tonight's refresh), floating
(genuinely urgent/actionable — reserved, not overused).

**Responsive** — mobile (<640px), tablet (640–959px), desktop (960px+).

---

## 04 — Global Navigation System

**Admin & Worker** (authenticated, task-based tools):
- Desktop: fixed left sidebar, grouped labels, current section highlighted.
- Mobile: bottom tab bar, 4–5 items max, "More" catch-all for the rest —
  matching your own sketch exactly.
- Tabs determined by actual usage frequency (Orders and Today's numbers
  first, Settings/Account last), not alphabetical or aesthetic ordering.

**Customer & Public** (`index.html`, `customer.html`):
- No sidebar — a lightweight top bar is enough; these are shorter,
  linear experiences, not control panels.
- `index.html`'s existing "Staff Login" corner stays as-is unless you
  decide otherwise (flagged last round, your call, not mine).

---

## 05 — Admin Information Architecture

The 27 cards already group into six real categories, based on the
section dividers that already exist in the file — this is audited
grouping, not invented:

- **Overview** — Top Actions, Command Center, Notifications (today's
  priority, at the front door, exactly as it is today — this part is
  already right).
- **Orders** — the order list, search, and status management.
- **Money** — Money Owed, Expenses, End of Day, Delegate/Reward, Flagged.
- **Team** — Team, Top Performers, What Sells, Relationships.
- **Inventory** — Low Stock, Fast Restock, Stock, Audit, Catalog.
- **Customers** — Contact Customers, Upload Team, Marketing Sources, Reviews.

Six sidebar items, not 27 flat peers. Overview stays the landing view —
it already answers "did we make money / what needs attention" better
than anything else on the page, it just needs to stop being buried
under 26 siblings.

---

## 06 — Worker Information Architecture

Deliberately shallower than admin — three groups, not six, reflecting
"execute, don't manage":

- **Do Now** — Quick Sale front and center (already the hero feature in
  the code, per your own brief's instinct), today's assigned tasks.
- **Report** — Expense logging, stock updates.
- **History** — past sales, completed tasks.

Same navigation *pattern* as admin (sidebar/bottom-tabs), far less
inside it. A worker opening this should see "what do I do right now"
before anything else, full stop.

---

## 07 — Customer Experience Architecture

Two distinct experiences, not one wizard — this is the corrected model,
not the original one:

**Discovery** (unstructured, browsable, no pressure):
`featuredServices`, `galleryCard`, `reviewsWidgetCard`, and catalog
search/browse all belong here. A customer can look around, get a feel
for the work, with zero forced sequence.

**Order Flow** (guided, appears once they act):
The moment someone picks a product or item to buy, the experience shifts
— `orderForm`'s fields become a short Customize → Review → Confirm
sequence rather than one long form sitting below the fold. The existing
sticky mini-cart bar is actually the right bridge between these two
modes already — it should become the explicit trigger that shifts the
page from Discovery into Order Flow, not just a running total.

---

## 08 — Desktop Layout Strategy

- Admin/Worker: sidebar + content area, more information density than
  mobile — multi-column stat grids, tables instead of stacked cards
  where the data is tabular.
- Customer/Public: wider multi-column layout for the catalog grid and
  gallery; the order form gets more breathing room, not just a wider
  version of the mobile column.

## 09 — Mobile Layout Strategy

- Admin/Worker: bottom tab bar, single-column content, large touch
  targets — several existing controls (status-select dropdowns, small
  icon buttons) need real thumb-sized targets, not mouse-sized ones.
- Customer: stays naturally single-column (already mobile-appropriate
  today), but the Discovery/Order Flow distinction from §07 applies
  identically on mobile — the shift in mode matters more than the
  column count here.
- No layout, anywhere, that requires horizontal scrolling. Admin's
  tables are the specific place worth auditing first for this.

---

## 10 — Component System

Reusable shapes, generated by shared functions (plain HTML/JS, no
framework, per the earlier architecture audit):

`NavSidebar` / `NavBottomBar`, `StatCard`, `ActionCard` (something
needing attention + a clear next step), `OrderCard`, `ProductCard`,
`SectionHeader`, `EmptyState`, `LoadingState`, `Modal`, `Toast` (already
consistent), `Badge` (status colors already exist, just need consistent
usage). Each defined once, used everywhere it's currently hand-rolled.

---

## 11 — Page-by-Page Visual Transformation

- **`index.html`** — add the two missing sections (How It Works, Why
  Us) and a real closing CTA before the footer, per your own sketch:
  Hero → What We Customize → How It Works → Why Us → Gallery/Proof →
  Strong CTA → Footer.
- **`admin.html`** — sidebar/bottom-tab navigation per §05; apply the
  elevation system so Overview's urgent items outrank Settings visually,
  not just positionally.
- **`worker.html`** — same navigation pattern, §06's shallower grouping,
  Quick Sale gets the most visual weight on the page.
- **`customer.html`** — restructured into Discovery/Order Flow per §07;
  the mini-cart bar becomes the explicit bridge between the two.
- **`apply.html`** — smallest change; benefits from the formalized type
  scale and elevation tiers once those exist, structure is already right.

---

## 12 — What Must Remain Untouched

Firebase configuration, Firestore collections and documents, every
Cloud Function, every security rule, every transaction and validation
path, every financial calculation, every `id` and `class` any existing
JavaScript reads or toggles, all data structures. This migration changes
HTML structure, CSS, layout, and navigation — nothing that writes to or
reads from the database changes shape.

---

## 13 — Migration Order

Lowest-risk, most-foundational first, so each phase can be checked
before the next depends on it:

1. **Design system** (§03) — tokens, type scale, spacing scale as one
   shared source, replacing the four independently-duplicated `:root`
   blocks (already flagged as a real duplication in the earlier audit).
2. **Component system** (§10) — build the reusable shapes once, before
   any page gets restructured around them.
3. **`apply.html`** — smallest page, least risk, proves the new
   components work before touching anything bigger.
4. **`index.html`** — add the missing sections, still relatively
   contained, no authenticated logic to risk.
5. **`admin.html` navigation** — highest-value, highest-visibility
   change; do this once components are proven on two smaller pages first.
6. **`worker.html` navigation** — same pattern as admin, lower risk
   since it's simpler.
7. **`customer.html`** — last, because it's the one with real behavioral
   change (Discovery/Order Flow split) on top of visual change, and
   should land once every component and pattern it depends on has
   already shipped and been checked elsewhere.

Still waiting for your approval before phase 1 starts.
