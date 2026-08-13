/* ============================================================
   Elite Customs — Shared Utilities
   ------------------------------------------------------------
   Single source of truth for logic that used to be copy-pasted
   across index.html, customer.html, track.html, worker.html,
   and admin.html. Before this file existed, five pieces of
   business logic lived as near-identical duplicates in every
   page — including PRODUCTION_CHECKLISTS, which had a comment
   in two different files literally saying "keep this in sync"
   as the only safeguard against drift.

   Load this AFTER the Firebase compat SDK <script> tags and
   BEFORE each page's own <script> block:

     <script src="https://www.gstatic.com/firebasejs/.../firebase-app-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/.../firebase-firestore-compat.js"></script>
     <script src="shared.js"></script>
     <script> ...page-specific code... </script>

   What stayed OUT of this file on purpose: statusMeta() (track.html)
   and productionMeta() (worker.html) look similar but genuinely
   differ — the customer-facing tracker collapses several production
   stages into one "in progress" color, while the staff queue gives
   each stage its own color so workers can scan it at a glance.
   Merging them would make one of the two pages worse, so they stay
   page-specific rather than being forced into a false single source.
   ============================================================ */

var firebaseConfig = {
  apiKey: "AIzaSyDTsJvTWgYdHb9wLF-MSXGbxvZf5LPA_jA",
  authDomain: "elite-customs-os.firebaseapp.com",
  projectId: "elite-customs-os",
  storageBucket: "elite-customs-os.firebasestorage.app",
  messagingSenderId: "628800846035",
  appId: "1:628800846035:web:8d3f8f3f1935909876bc26",
  measurementId: "G-H082LD7630"
};
firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();
// Only admin.html and worker.html load the firebase-auth-compat SDK.
// Guard so pages without it (index/customer/track) don't throw on load.
var auth = (typeof firebase.auth === 'function') ? firebase.auth() : null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c];
  });
}

function text(v, fallback) {
  var out = (v === undefined || v === null || v === '') ? (fallback || '\u2014') : v;
  return escapeHtml(out);
}

function normalizePhone(raw) {
  var digits = (raw || '').replace(/\D/g, '');
  return digits.slice(-9);
}

// Canonical order-normalizer. Uses the fuller item shape (productId /
// unitPrice / lineTotal / custom) admin.html needs for inventory and
// receipts — track.html and worker.html simply don't read those extra
// fields, so the richer shape is safe everywhere.
//
// One deliberate behavior fix made while unifying: balance is now always
// clamped at 0 via Math.max(0, ...), matching what track.html already did.
// admin.html and worker.html previously could show a *negative* balance on
// an overpaid order (e.g. "-500"), which doesn't make sense in a field
// meant to represent money still owed — the shop can't owe a customer
// through a "balance" line. Clamping to 0 is the correct behavior across
// every page now.
function normalizeOrder(o) {
  if (!o.items) {
    o.items = o.itemType
      ? [{ productId: null, name: o.itemType, qty: o.quantity || 1, unitPrice: o.totalAmount || 0, lineTotal: o.totalAmount || 0, custom: true }]
      : [];
  }
  if (typeof o.total !== 'number') o.total = o.totalAmount || 0;
  if (typeof o.amountPaid !== 'number') o.amountPaid = 0;
  if (typeof o.balance !== 'number') o.balance = Math.max(0, o.total - o.amountPaid);
  if (!o.paymentStatus) o.paymentStatus = o.balance <= 0 && o.total > 0 ? 'paid' : (o.amountPaid > 0 ? 'partial' : 'unpaid');
  if (!o.productionStatus) {
    var legacyMap = { pending: 'new', designing: 'designing', printing: 'printing', 'in-progress': 'printing', ready: 'ready', completed: 'delivered' };
    o.productionStatus = legacyMap[o.status] || 'new';
  }
  if (!o.overallStatus) o.overallStatus = (o.productionStatus === 'delivered' && o.paymentStatus === 'paid') ? 'completed_settled' : 'open';
  return o;
}

// Production checklist steps — was pasted verbatim into both admin.html
// and worker.html. Now it exists once; a step edited here updates the
// staff checklist and the owner's progress view together, permanently.
var PRODUCTION_CHECKLISTS = {
  frosted: [
    'Understand the vision — what they want, how it\'ll look on their device',
    'Design source — existing artwork picked, or custom (design + advise)',
    'Deposit collected',
    'Design finalized (if custom)',
    'Print',
    'Laminate',
    'Trim',
    'Install',
    'Customer approval — final look',
    'Balance payment',
    'Delivered'
  ]
};

function checklistTemplateFor(items) {
  if (!items || !items.length) return null;
  var isFrosted = items.some(function (it) { return /frosted/i.test(it.name || ''); });
  return isFrosted ? 'frosted' : null;
}
