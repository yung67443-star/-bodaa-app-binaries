/**
 * Dolce Ambassador Standalone Service V2
 * - Meal slots: 1-2-3 sequence per week (Mon-Sun Nairobi). Miss Monday = claim Tue, order enforced.
 *   Slot1: no gate. Slot2: >=5 installs + >=1 valid order. Slot3: >=10 installs + >=4 valid orders.
 * - Meals: request -> admin approve -> +150 credit to ambassador's REAL BodaWallet (passengers.wallet_balance)
 * - 40%: commissions go to ESCROW. Week1 withdraw -> BodaWallet (after approval). Week2+ -> M-Pesa (after approval).
 * - Wallet credits use transaction + lock + wallet_transactions log (same pattern as walletLedger.listener.js)
 */

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');

function db() { return getFirestore(); }
function rtdb() { return getDatabase(); }

const AMB_RATE = 0.40;
const WINDOW_DAYS = 30;
const VENDOR_RATE_FALLBACK = 0.19;
const DRIVER_RATE_FALLBACK = 0.20;
const ITEM_FEE_FALLBACK = 7;
const MEAL_AMOUNT = 150;

function normPhone(p) {
  let x = String(p || '').replace(/\D/g, '');
  if (x.startsWith('2540')) x = '254' + x.slice(4);
  if (x.startsWith('0')) x = '254' + x.slice(1);
  if (/^7\d{8}$/.test(x)) x = '254' + x;
  if (/^1\d{8}$/.test(x)) x = '254' + x;
  return x;
}
function phoneVariants(p) {
  const n = normPhone(p);
  const last9 = n.slice(-9);
  const zero = '0' + last9;
  return [...new Set([n, zero, last9, String(p || '').trim()])].filter(Boolean);
}
function last9(p) { return normPhone(p).slice(-9); }

function weekKey(d = new Date()) {
  const nairobi = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
  const day = (nairobi.getDay() + 6) % 7;
  const monday = new Date(nairobi);
  monday.setDate(nairobi.getDate() - day);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${y}-W${m}${dd}`;
}

// Orders collection = food by default. Only exclude explicit ride/parcel/taxi.
function isFoodOrder(o) {
  const raw = o.serviceType || o.orderType || o.service_type || o.type || '';
  if (!raw) return true; // ORDER-CB4B4E has no serviceType but has vendorId/items -> food
  const t = String(raw).toLowerCase();
  if (t.includes('ride') || t.includes('parcel') || t.includes('taxi') || t.includes('package')) return false;
  return true;
}
function isDeliveredPaid(o) {
  const s = String(o.orderStatus || o.status || '').toUpperCase().trim();
  return s === 'DELIVERED' || s === 'DELIVERED_AND_PAID' || s === 'DELIVEREDANDPAID';
}

function calcDolceEarning(orderData) {
  const vendorGross = parseFloat(orderData.vendor_gross ?? orderData.gross_product_total ?? orderData.grossProductTotal ?? 0) || 0;
  const deliveryFee = parseFloat(orderData.delivery_fee ?? orderData.deliveryFee ?? 0) || 0;
  let vendorComm = parseFloat(orderData.platform_vendor_commission ?? orderData.platformVendorCommission ?? NaN);
  if (!(vendorComm > 0)) vendorComm = vendorGross > 0 ? Math.round(vendorGross * VENDOR_RATE_FALLBACK * 100) / 100 : 0;
  let driverComm = parseFloat(orderData.platform_driver_commission ?? orderData.platformDriverCommission ?? NaN);
  if (!(driverComm > 0)) driverComm = deliveryFee > 0 ? Math.round(deliveryFee * DRIVER_RATE_FALLBACK * 100) / 100 : 0;
  let surcharge = parseFloat(orderData.platform_item_surcharge ?? orderData.platformItemSurcharge ?? NaN);
  if (!(surcharge >= 0)) {
    const count = parseInt(orderData.item_count ?? orderData.itemCount ?? 0, 10) || 0;
    const fee = parseFloat(orderData.platform_item_fee ?? orderData.platformItemFee ?? ITEM_FEE_FALLBACK) || ITEM_FEE_FALLBACK;
    surcharge = Math.round(count * fee * 100) / 100;
  }
  const discount = parseFloat(orderData.combo_discount ?? orderData.comboDiscount ?? 0) || 0;
  const earning = Math.round((vendorComm + driverComm + surcharge - discount) * 100) / 100;
  return { earning: Math.max(0, earning), vendorComm, driverComm, surcharge, discount };
}

async function resolveAmbassadorIdForCustomer(customerId, orderData) {
  const direct = orderData.referred_by_ambassador || orderData.referredByAmbassadorId || orderData.ambassadorId;
  if (direct) {
    const chk = await db().collection('ambassadors').doc(String(direct)).get();
    if (chk.exists && chk.data().active !== false) return String(direct);
  }
  const code = String(orderData.referral_code || orderData.referralCode || '').trim().toUpperCase();
  if (code) {
    const q = await db().collection('ambassadors').where('code', '==', code).limit(1).get();
    if (!q.empty && q.docs[0].data().active !== false) return q.docs[0].id;
  }
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
  const refAt = p.referredAt || p.referred_at || p.createdAt;
  if (refAt) {
    const d = refAt.toDate ? refAt.toDate() : new Date(refAt);
    if (!isNaN(d)) { if ((Date.now() - d.getTime()) / 86400000 > WINDOW_DAYS) return null; }
  }
  const chk = await db().collection('ambassadors').doc(String(ambId)).get();
  if (!chk.exists || chk.data().active === false) return null;
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
  const customerId = orderData.customerId || orderData.userId || orderData.passenger_id;
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
    orderPhone: orderData.passenger_phone || orderData.passengerPhone || orderData.recipientPhone || null,
    orderTotal: parseFloat(orderData.total ?? 0) || 0,
    vendorGross: parseFloat(orderData.vendor_gross ?? orderData.gross_product_total ?? 0) || 0,
    deliveryFee: parseFloat(orderData.delivery_fee ?? 0) || 0,
    dolceEarning: earning,
    earningBreakdown: { vendorComm, driverComm, surcharge, discount },
    commissionRate: AMB_RATE,
    commissionAmount: commission,
    orderType: 'food_delivery',
    status: 'escrow', // V2: never direct to wallet
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

async function syncRecentOrders(limit = 200) {
  const snap = await rtdb().ref('orders').limitToLast(limit).once('value');
  const ids = [];
  snap.forEach((c) => ids.push(c.key));
  let credited = 0, skipped = 0;
  for (const id of ids) {
    try { const r = await ensureCommissionForOrderId(id); (r.ok && !r.deduped) ? credited++ : skipped++; }
    catch (_e) { skipped++; }
  }
  return { checked: ids.length, credited, skipped };
}

// ---- installs + valid orders ----
async function getInstalls(ambassadorId, ambCode) {
  const out = new Map();
  const s1 = await db().collection('passengers').where('referredByAmbassadorId', '==', ambassadorId).get();
  s1.forEach((d) => out.set(d.id, { id: d.id, ...d.data() }));
  if (ambCode) {
    try {
      const s2 = await db().collection('passengers').where('referralCode', '==', String(ambCode).toUpperCase()).get();
      s2.forEach((d) => { if (!out.has(d.id)) out.set(d.id, { id: d.id, ...d.data() }); });
    } catch (_e) {}
  }
  return [...out.values()];
}

async function getValidOrderStats(ambassadorId, ambPhone) {
  const snap = await db().collection('ambassador_commissions').where('ambassadorId', '==', ambassadorId).get();
  const all = snap.docs.map((d) => d.data());
  const selfLast = ambPhone ? last9(ambPhone) : '';
  const valid = all.filter((c) => {
    if (selfLast && c.orderPhone && last9(c.orderPhone) === selfLast) return false;
    return true;
  });
  const users = new Set(valid.map((c) => String(c.passengerId || c.orderPhone || c.orderId)));
  return { total: valid.length, distinctUsers: users.size, all: valid };
}

// ---- wallet-safe credit (mirrors walletLedger pattern) ----
async function findPassengerForAmbassador(amb) {
  if (amb.linkedPassengerId) {
    const s = await db().collection('passengers').doc(String(amb.linkedPassengerId)).get();
    if (s.exists) return { id: s.id, ref: s.ref, data: s.data() };
  }
  for (const v of phoneVariants(amb.phone)) {
    try {
      const q = await db().collection('passengers').where('phone', '==', v).limit(1).get();
      if (!q.empty) { const d = q.docs[0]; return { id: d.id, ref: d.ref, data: d.data() }; }
    } catch (_e) {}
  }
  return null;
}

async function creditPassengerWallet(passengerRef, amount, lockId, label, meta = {}) {
  const lockRef = db().collection('wallet_processing_locks').doc(lockId);
  const amt = Math.round(parseFloat(amount) * 100) / 100;
  if (!(amt > 0)) throw new Error('INVALID_AMOUNT');
  await db().runTransaction(async (t) => {
    const lock = await t.get(lockRef);
    if (lock.exists) throw new Error('ALREADY_PROCESSED');
    const p = await t.get(passengerRef);
    if (!p.exists) throw new Error('PASSENGER_MISSING');
    const bal = Math.round(parseFloat(p.data().wallet_balance || 0) * 100) / 100;
    t.update(passengerRef, { wallet_balance: Math.round((bal + amt) * 100) / 100 });
    t.set(lockRef, { processedAt: FieldValue.serverTimestamp(), amount: amt, type: label, ...meta });
    t.set(passengerRef.collection('wallet_transactions').doc(), {
      type: label, amount: amt, description: meta.description || label, refId: meta.refId || lockId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return amt;
}

// ---- meal slots ----
async function getSlotState(ambassadorId) {
  const wk = weekKey();
  const snap = await db().collection('ambassador_meal_claims')
    .where('ambassadorId', '==', ambassadorId).where('weekKey', '==', wk).get();
  const claims = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const bySlot = {};
  claims.forEach((c) => { bySlot[c.slot] = c; });
  return { wk, claims, bySlot };
}

function gateForSlot(slot, installs, orderUsers) {
  if (slot === 1) return { ok: true };
  if (slot === 2) {
    if (installs < 5) return { ok: false, reason: `Need 5 installs (you have ${installs})` };
    if (orderUsers < 1) return { ok: false, reason: 'Need at least 1 order from your referrals (not your own)' };
    return { ok: true };
  }
  if (slot === 3) {
    if (installs < 10) return { ok: false, reason: `Need 10 installs (you have ${installs})` };
    if (orderUsers < 4) return { ok: false, reason: `Need 4+ orders from referrals (you have ${orderUsers})` };
    return { ok: true };
  }
  return { ok: false, reason: 'Invalid slot' };
}

async function ambassadorStats(ambassadorId) {
  const ambSnap = await db().collection('ambassadors').doc(ambassadorId).get();
  if (!ambSnap.exists) return null;
  const amb = { id: ambSnap.id, ...ambSnap.data() };

  const referrals = await getInstalls(ambassadorId, amb.code);
  const { total: validOrders, distinctUsers } = await getValidOrderStats(ambassadorId, amb.phone);

  const comSnap = await db().collection('ambassador_commissions').where('ambassadorId', '==', ambassadorId).get();
  const commissions = comSnap.docs.map((d) => d.data());
  // Treat both legacy 'approved' and new 'escrow' as earned escrow
  const totalEarned = Math.round(commissions.reduce((s, c) => s + (parseFloat(c.commissionAmount) || 0), 0) * 100) / 100;

  const paySnap = await db().collection('ambassador_payouts').where('ambassadorId', '==', ambassadorId).get();
  const payouts = paySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const consumed = payouts.filter((p) => ['approved', 'paid'].includes(p.status)).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const paidOut = Math.round(consumed * 100) / 100;
  const available = Math.round((totalEarned - paidOut) * 100) / 100;

  const { wk, claims, bySlot } = await getSlotState(ambassadorId);
  const gates = {
    1: { ok: !bySlot[1], reason: bySlot[1] ? `Slot 1 ${bySlot[1].status}` : '' },
    2: bySlot[2] ? { ok: false, reason: `Slot 2 ${bySlot[2].status}` }
      : (!bySlot[1] ? { ok: false, reason: 'Claim Slot 1 first' } : gateForSlot(2, referrals.length, distinctUsers)),
    3: bySlot[3] ? { ok: false, reason: `Slot 3 ${bySlot[3].status}` }
      : (!bySlot[2] ? { ok: false, reason: 'Claim Slot 2 first' } : gateForSlot(3, referrals.length, distinctUsers)),
  };

  const TEN_DAYS = 10 * 86400000;
  const activeRefs = new Set(commissions.filter((c) => {
    const t = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().getTime() : (c.orderTimestamp || 0);
    return Date.now() - Number(t) < TEN_DAYS;
  }).map((c) => c.passengerId));

  return {
    amb, referrals, commissions: commissions.sort((a, b) => (b.orderTimestamp || 0) - (a.orderTimestamp || 0)).slice(0, 50),
    installs: referrals.length, validOrders, distinctOrderUsers: distinctUsers,
    totalEarned, paidOut, available,
    activeReferralCount: activeRefs.size,
    weekKey: wk, mealClaims: claims, slots: bySlot, gates,
    mealsUsed: claims.filter((c) => ['requested', 'approved'].includes(c.status)).length,
    mealsLeft: Math.max(0, 3 - claims.filter((c) => ['requested', 'approved'].includes(c.status)).length),
    payouts: payouts.sort((a, b) => ((b.requestedAt && b.requestedAt._seconds) || 0) - ((a.requestedAt && a.requestedAt._seconds) || 0)).slice(0, 20),
  };
}

module.exports = {
  AMB_RATE, WINDOW_DAYS, MEAL_AMOUNT, normPhone, last9, phoneVariants, weekKey,
  calcDolceEarning, resolveAmbassadorIdForCustomer, ensureCommissionForOrderId, syncRecentOrders,
  getInstalls, getValidOrderStats, getSlotState, gateForSlot,
  findPassengerForAmbassador, creditPassengerWallet, ambassadorStats,
};