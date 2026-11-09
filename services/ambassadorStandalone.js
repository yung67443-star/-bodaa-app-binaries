/**
 * Dolce Ambassador Standalone Service
 * - Does NOT import fareCalculator.js or payout.service.js
 * - Reads the SAME Firebase (Firestore + RTDB) your main backend writes to
 * - Food orders ONLY. Rides/parcels = 0.
 *
 * Firestore (new, safe collections - won't break main backend):
 *   ambassadors/{ambId} {code, name, phone, school, active, createdAt}
 *   ambassador_commissions/{amb-ORDERID} {ambassadorId, orderId, dolceEarning, commissionAmount, status}
 *   ambassador_payouts/{payoutId} {ambassadorId, amount, mpesaPhone, status}
 *   ambassador_meals/{mealId} {ambassadorId, weekKey, amount:150}
 *
 * RTDB (read-only): orders/{orderId}
 */

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');

function db() { return getFirestore(); }
function rtdb() { return getDatabase(); }

const AMB_RATE = 0.40;
const WINDOW_DAYS = 30;
const VENDOR_RATE_FALLBACK = 0.19;
const DRIVER_RATE_FALLBACK = 0.20;
const ITEM_FEE_FALLBACK = 7; // your sample order used 7, fareCalculator default is 10. We use stored surcharge first.

function normPhone(p) {
  let x = String(p || '').replace(/\D/g, '');
  if (x.startsWith('2540')) x = '254' + x.slice(4);
  if (x.startsWith('0')) x = '254' + x.slice(1);
  if (/^7\d{8}$/.test(x)) x = '254' + x;
  if (/^1\d{8}$/.test(x)) x = '254' + x;
  return x;
}
function last9(p) { return normPhone(p).slice(-9); }

function weekKey(d = new Date()) {
  // Monday-start week key in Africa/Nairobi
  const nairobi = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
  const day = (nairobi.getDay() + 6) % 7; // Mon=0
  const monday = new Date(nairobi);
  monday.setDate(nairobi.getDate() - day);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${y}-W${m}${dd}`;
}

function isFoodOrder(o) {
  const t = String(o.serviceType || o.orderType || o.service_type || 'food_delivery').toLowerCase();
  return t.includes('food');
}
function isDeliveredPaid(o) {
  const s = String(o.orderStatus || o.status || '').toUpperCase().trim();
  return s === 'DELIVERED' || s === 'DELIVERED_AND_PAID' || s === 'DELIVEREDANDPAID';
}

function calcDolceEarning(orderData) {
  // Prefer stored platform fields (written by your main backend). Fallback recompute.
  const vendorGross = parseFloat(orderData.vendor_gross ?? orderData.gross_product_total ?? orderData.grossProductTotal ?? 0) || 0;
  const deliveryFee = parseFloat(orderData.delivery_fee ?? orderData.deliveryFee ?? 0) || 0;
  let vendorComm = parseFloat(orderData.platform_vendor_commission ?? orderData.platformVendorCommission ?? NaN);
  if (!(vendorComm > 0)) {
    // sample ORDER-CB4B4E has 0 here but vendor_gross 145 -> recompute fairly
    vendorComm = vendorGross > 0 ? Math.round(vendorGross * VENDOR_RATE_FALLBACK * 100) / 100 : 0;
  }
  let driverComm = parseFloat(orderData.platform_driver_commission ?? orderData.platformDriverCommission ?? NaN);
  if (!(driverComm > 0)) {
    driverComm = deliveryFee > 0 ? Math.round(deliveryFee * DRIVER_RATE_FALLBACK * 100) / 100 : 0;
  }
  let surcharge = parseFloat(orderData.platform_item_surcharge ?? orderData.platformItemSurcharge ?? NaN);
  if (!(surcharge >= 0)) {
    const count = parseInt(orderData.item_count ?? orderData.itemCount ?? 0, 10) || 0;
    const fee = parseFloat(orderData.platform_item_fee ?? orderData.platformItemFee ?? ITEM_FEE_FALLBACK) || ITEM_FEE_FALLBACK;
    surcharge = Math.round(count * fee * 100) / 100;
  }
  const discount = parseFloat(orderData.combo_discount ?? orderData.comboDiscount ?? orderData.combo_discount ?? 0) || 0;
  const earning = Math.round((vendorComm + driverComm + surcharge - discount) * 100) / 100;
  return { earning: Math.max(0, earning), vendorComm, driverComm, surcharge, discount };
}

async function resolveAmbassadorIdForCustomer(customerId, orderData) {
  // 1. fast path: order already carries it (added by new Android code)
  const direct = orderData.referred_by_ambassador || orderData.referredByAmbassadorId || orderData.ambassadorId;
  if (direct) {
    const chk = await db().collection('ambassadors').doc(String(direct)).get();
    if (chk.exists && chk.data().active !== false) return String(direct);
  }
  // 2. code path
  const code = String(orderData.referral_code || orderData.referralCode || '').trim().toUpperCase();
  if (code) {
    const q = await db().collection('ambassadors').where('code', '==', code).limit(1).get();
    if (!q.empty && q.docs[0].data().active !== false) return q.docs[0].id;
  }
  // 3. passenger profile path (works even without Android update)
  if (!customerId) return null;
  const psnap = await db().collection('passengers').doc(String(customerId)).get();
  if (!psnap.exists) return null;
  const p = psnap.data() || {};
  let ambId = p.referredByAmbassadorId || p.referred_by_ambassador || null;
  if (!ambId && p.referralCode) {
    const q = await db().collection('ambassadors').where('code', '==', String(p.referralCode).toUpperCase()).limit(1).get();
    if (!q.empty) ambId = q.docs[0].id;
  }
  if (!ambId) return null;
  // 30-day window check
  const refAt = p.referredAt || p.referred_at || p.createdAt;
  if (refAt) {
    const d = refAt.toDate ? refAt.toDate() : new Date(refAt);
    if (!isNaN(d)) {
      const days = (Date.now() - d.getTime()) / 86400000;
      if (days > WINDOW_DAYS) return null;
    }
  }
  const chk = await db().collection('ambassadors').doc(String(ambId)).get();
  if (!chk.exists || chk.data().active === false) return null;
  // anti-fraud: ambassador cannot earn from own order (same phone last9)
  try {
    const ambPhone = chk.data().phone || '';
    const orderPhone = orderData.paid_by_phone || orderData.passenger_phone || orderData.passengerPhone || orderData.orderer_phone || '';
    if (ambPhone && orderPhone && last9(ambPhone) && last9(ambPhone) === last9(orderPhone)) return null;
  } catch (_e) {}
  return String(ambId);
}

async function ensureCommissionForOrderId(orderId) {
  const osnap = await rtdb().ref(`orders/${orderId}`).once('value');
  if (!osnap.exists()) return { ok: false, reason: 'order-not-found' };
  const orderData = osnap.val() || {};
  if (!isFoodOrder(orderData)) return { ok: false, reason: 'not-food' };
  if (!isDeliveredPaid(orderData)) return { ok: false, reason: 'not-delivered-paid' };

  const customerId = orderData.customerId || orderData.userId || orderData.customer_id;
  const ambassadorId = await resolveAmbassadorIdForCustomer(customerId, orderData);
  if (!ambassadorId) return { ok: false, reason: 'no-ambassador-or-window-expired' };

  const commRef = db().collection('ambassador_commissions').doc(`amb-${orderId}`);
  const dup = await commRef.get();
  if (dup.exists) return { ok: true, deduped: true, id: commRef.id };

  const { earning, vendorComm, driverComm, surcharge, discount } = calcDolceEarning(orderData);
  if (!(earning > 0)) return { ok: false, reason: 'zero-earning' };
  const commission = Math.round(earning * AMB_RATE * 100) / 100;

  const ambSnap = await db().collection('ambassadors').doc(ambassadorId).get();
  const batch = db().batch();
  batch.set(commRef, {
    ambassadorId,
    ambassadorCode: ambSnap.exists ? (ambSnap.data().code || null) : null,
    orderId,
    passengerId: customerId || null,
    orderTotal: parseFloat(orderData.total ?? 0) || 0,
    vendorGross: parseFloat(orderData.vendor_gross ?? orderData.gross_product_total ?? 0) || 0,
    deliveryFee: parseFloat(orderData.delivery_fee ?? 0) || 0,
    dolceEarning: earning,
    earningBreakdown: { vendorComm, driverComm, surcharge, discount },
    commissionRate: AMB_RATE,
    commissionAmount: commission,
    orderType: 'food_delivery',
    status: 'approved',
    createdAt: FieldValue.serverTimestamp(),
    orderTimestamp: orderData.timestamp || orderData.updatedAt || Date.now(),
  });
  batch.update(db().collection('ambassadors').doc(ambassadorId), {
    totalOrders: FieldValue.increment(1),
    totalEarningsBalance: FieldValue.increment(commission),
    lastOrderAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { ok: true, commission, earning };
}

// Sweep recent RTDB orders and credit any missing (safe to run on every dashboard load).
async function syncRecentOrders(limit = 400) {
  const snap = await rtdb().ref('orders').limitToLast(limit).once('value');
  const ids = [];
  snap.forEach((c) => ids.push(c.key));
  let credited = 0, skipped = 0;
  for (const id of ids) {
    try {
      const r = await ensureCommissionForOrderId(id);
      if (r.ok && !r.deduped) credited++;
      else skipped++;
    } catch (_e) { skipped++; }
  }
  return { checked: ids.length, credited, skipped };
}

async function ambassadorStats(ambassadorId) {
  const ambSnap = await db().collection('ambassadors').doc(ambassadorId).get();
  if (!ambSnap.exists) return null;
  const amb = { id: ambSnap.id, ...ambSnap.data() };

  const refSnap = await db().collection('passengers').where('referredByAmbassadorId', '==', ambassadorId).get();
  const referrals = refSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const comSnap = await db().collection('ambassador_commissions').where('ambassadorId', '==', ambassadorId).get();
  const commissions = comSnap.docs.map((d) => d.data());
  const totalEarned = Math.round(commissions.reduce((s, c) => s + (parseFloat(c.commissionAmount) || 0), 0) * 100) / 100;

  const paySnap = await db().collection('ambassador_payouts').where('ambassadorId', '==', ambassadorId).get();
  const payouts = paySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const paidOut = Math.round(payouts.filter((p) => p.status === 'paid' || p.status === 'approved').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;
  const available = Math.round((totalEarned - paidOut) * 100) / 100;

  // last order date across commissions
  let lastOrderAt = amb.lastOrderAt || null;
  // active = ordered in last 10 days
  const TEN_DAYS = 10 * 86400000;
  const activeRefs = new Set(commissions.filter((c) => {
    const t = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().getTime() : (c.orderTimestamp || 0);
    return Date.now() - Number(t) < TEN_DAYS;
  }).map((c) => c.passengerId));

  // meals this week
  const wk = weekKey();
  const mealSnap = await db().collection('ambassador_meals').where('ambassadorId', '==', ambassadorId).where('weekKey', '==', wk).get();
  const mealsUsed = mealSnap.size;

  return { amb, referrals, commissions: commissions.sort((a, b) => (b.orderTimestamp || 0) - (a.orderTimestamp || 0)).slice(0, 50), totalEarned, paidOut, available, activeReferralCount: activeRefs.size, mealsUsed, mealsLeft: Math.max(0, 3 - mealsUsed), weekKey: wk, payouts: payouts.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0)).slice(0, 20) };
}

module.exports = { AMB_RATE, WINDOW_DAYS, normPhone, last9, weekKey, calcDolceEarning, resolveAmbassadorIdForCustomer, ensureCommissionForOrderId, syncRecentOrders, ambassadorStats };
