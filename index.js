const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

/**
 * createOrder — the ONLY way an anonymous customer can create an order once
 * firestore.rules is updated to block direct public writes to /orders.
 *
 * Why this exists: the old flow had the customer's browser write the order
 * document directly to Firestore, including its own price/total fields.
 * Firestore Security Rules can check "is total a non-negative number" but
 * cannot loop through a cart and verify each item's price against the real
 * products collection — that kind of per-item lookup and arithmetic needs
 * real server-side code. This function is that code: it trusts nothing
 * about price from the client except which product and how many of it —
 * every price, every line total, and the order's final total are computed
 * here from the live products collection, not from whatever the browser
 * sent.
 *
 * The client still generates the receipt number beforehand (via the
 * existing per-year counter in customer.html) and passes it in — that's
 * fine to trust, since a receipt number has no fraud value on its own.
 */
exports.createOrder = functions.https.onCall(async (data, context) => {
  const customerName = typeof data.customerName === 'string' ? data.customerName.trim() : '';
  const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
  const phoneKey = typeof data.phoneKey === 'string' ? data.phoneKey.trim() : '';
  const email = typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null;
  const description = typeof data.description === 'string' ? data.description.slice(0, 2000) : '';
  const receiptNumber = typeof data.receiptNumber === 'string' ? data.receiptNumber : null;
  const source = typeof data.source === 'string' ? data.source : 'website';
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const artwork = data.artwork && typeof data.artwork === 'object' ? data.artwork : null;

  // Same shape limits the old Firestore rule enforced on customerName/phone —
  // kept here since this function bypasses those rules entirely (Admin SDK
  // writes are not subject to security rules).
  if (!customerName || customerName.length >= 200) {
    throw new functions.https.HttpsError('invalid-argument', 'Enter a valid name.');
  }
  if (!phone || phone.length >= 30) {
    throw new functions.https.HttpsError('invalid-argument', 'Enter a valid phone number.');
  }
  if (!receiptNumber) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing receipt number.');
  }
  if (rawItems.length === 0 || rawItems.length > 50) {
    throw new functions.https.HttpsError('invalid-argument', 'An order needs 1–50 items.');
  }

  // This is the actual fix: every catalog item's real name and price come
  // from the live products collection, looked up by productId — never
  // from whatever the browser claims. A "custom item" (bespoke request,
  // no catalog product — customer.html's addCustomItem()) is the one
  // legitimate exception: it always carries unitPrice 0 and gets priced
  // by staff afterward, so there's no catalog price to validate it
  // against and no fraud risk in leaving it at 0.
  const catalogItems = rawItems.filter((it) => it && it.productId);
  const customItems = rawItems.filter((it) => !it || !it.productId);
  if (customItems.some((it) => !it || typeof it.name !== 'string' || !it.name.trim())) {
    throw new functions.https.HttpsError('invalid-argument', 'Every custom item needs a description.');
  }

  const productSnaps = await Promise.all(catalogItems.map((it) => db.collection('products').doc(it.productId).get()));

  const builtItems = [];
  let subtotal = 0;
  for (let i = 0; i < catalogItems.length; i++) {
    const requested = catalogItems[i];
    const snap = productSnaps[i];
    if (!snap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'One of the items in your cart is no longer available — please refresh and try again.');
    }
    const product = snap.data();
    const qty = Math.max(1, Math.min(1000, Math.floor(Number(requested.qty) || 0)));
    if (qty <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Item quantity must be at least 1.');
    }

    // Wholesale pricing only applies if the product actually has it
    // configured AND the requested quantity genuinely meets the minimum —
    // never because the client's cart says "priceTier: wholesale".
    const wantsWholesale = requested.priceTier === 'wholesale';
    const wholesaleEligible = wantsWholesale
      && typeof product.wholesalePrice === 'number' && product.wholesalePrice > 0
      && typeof product.wholesaleMinQty === 'number' && product.wholesaleMinQty > 0
      && qty >= product.wholesaleMinQty;
    const unitPrice = wholesaleEligible ? product.wholesalePrice : (product.retailPrice || 0);
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;

    // customOptions are purely descriptive (Finish: Glossy, Size: A5) —
    // never priced, so they're trusted from the client same as a note
    // would be, just structured instead of free text. Still sanitized to
    // plain short strings so this can't be used to smuggle unexpected
    // data types into the order document.
    const customOptions = {};
    if (requested.customOptions && typeof requested.customOptions === 'object') {
      Object.keys(requested.customOptions).slice(0, 10).forEach((key) => {
        const val = requested.customOptions[key];
        if (typeof key === 'string' && typeof val === 'string' && key.length < 100 && val.length < 200) {
          customOptions[key.slice(0, 100)] = val.slice(0, 200);
        }
      });
    }

    builtItems.push({
      productId: snap.id,
      name: product.name || 'Item',
      qty: qty,
      unitPrice: unitPrice,
      lineTotal: lineTotal,
      priceTier: wholesaleEligible ? 'wholesale' : 'retail',
      customOptions: customOptions
    });
  }

  // Custom items pass through as staff-priced-later, always at 0 — the
  // description is the only thing trusted from the client, capped to a
  // sane length, same as the order description field above.
  for (const requested of customItems) {
    const qty = Math.max(1, Math.min(1000, Math.floor(Number(requested.qty) || 1)));
    builtItems.push({
      productId: null,
      name: requested.name.trim().slice(0, 300),
      qty: qty,
      unitPrice: 0,
      lineTotal: 0,
      custom: true
    });
  }

  // Loyalty discount, computed the same way checkLoyaltyStatus() does in
  // customer.html — replicated here rather than trusted from the client,
  // since a discount percentage is also a price field.
  let loyaltyDiscountApplied = false;
  let loyaltyDiscountPercent = 0;
  let loyaltyDiscountAmount = 0;
  if (phoneKey) {
    try {
      const loyaltyDoc = await db.collection('settings').doc('loyaltyConfig').get();
      const loyaltyConfig = loyaltyDoc.exists ? loyaltyDoc.data() : null;
      if (loyaltyConfig && loyaltyConfig.enabled && phoneKey.length >= 9) {
        const threshold = loyaltyConfig.visitThreshold || 5;
        const priorOrders = await db.collection('orders').where('phoneKey', '==', phoneKey).get();
        if (priorOrders.size >= threshold) {
          loyaltyDiscountApplied = true;
          loyaltyDiscountPercent = loyaltyConfig.discountPercent || 0;
          loyaltyDiscountAmount = Math.round(subtotal * (loyaltyDiscountPercent / 100));
        }
      }
    } catch (e) {
      // Fails safe, same as the client's own catch block — no discount,
      // order still goes through.
      loyaltyDiscountApplied = false; loyaltyDiscountPercent = 0; loyaltyDiscountAmount = 0;
    }
  }

  // Tip is the customer's own goodwill amount, not a catalog price — still
  // clamped to a sane range so it can't be used to smuggle an absurd
  // number into the order total.
  const tipAmount = Math.max(0, Math.min(1000000, Math.round(Number(data.tipAmount) || 0)));
  const total = Math.max(0, subtotal - loyaltyDiscountAmount) + tipAmount;

  const orderRef = await db.collection('orders').add({
    customerName: customerName,
    phone: phone,
    phoneKey: phoneKey || null,
    email: email,
    items: builtItems,
    subtotalBeforeDiscount: subtotal,
    loyaltyDiscountApplied: loyaltyDiscountApplied,
    loyaltyDiscountPercent: loyaltyDiscountApplied ? loyaltyDiscountPercent : 0,
    loyaltyDiscountAmount: loyaltyDiscountAmount,
    total: total,
    tipAmount: tipAmount,
    tipAssigned: false,
    inventoryDeducted: false,
    amountPaid: 0,
    balance: total,
    paymentStatus: 'unpaid',
    productionStatus: 'new',
    overallStatus: 'open',
    description: description,
    receiptNumber: receiptNumber,
    source: source,
    artworkUrl: artwork ? artwork.url : null,
    artworkFilename: artwork ? artwork.filename : null,
    artworkSize: artwork ? artwork.size : null,
    artworkUploadedAt: artwork ? artwork.uploadedAt : null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { orderId: orderRef.id, receiptNumber: receiptNumber, total: total };
});
