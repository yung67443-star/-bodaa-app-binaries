/**
 * Standalone Ambassador Routes V2 - mounts at /api/ambassador
 * Meal slots (1-2-3 sequence) + separate admin queues for meals vs withdrawals.
 * Escrow: Week1 withdraw -> BodaWallet, Week2+ -> M-Pesa.
 */
const express = require('express');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const amb = require('../services/ambassadorStandalone');

const router = express.Router();
const db = () => getFirestore();

function makeCode(name, count) {
  const base = String(name || 'AMB').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'AMB';
  return `DOLCE-${base}-${String(count + 1).padStart(2, '0')}`;
}
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey || req.body.adminKey;
  if (!process.env.AMB_ADMIN_KEY) return res.status(500).json({ success: false, error: 'AMB_ADMIN_KEY not set on server' });
  if (key !== process.env.AMB_ADMIN_KEY) return res.status(401).json({ success: false, error: 'Unauthorized admin' });
  next();
}
const accountAgeDays = (ambDoc) => {
  const c = ambDoc.createdAt && ambDoc.createdAt.toDate ? ambDoc.createdAt.toDate() : null;
  if (!c) return 999;
  return (Date.now() - c.getTime()) / 86400000;
};

// Admin: create ambassador (auto-link wallet by phone)
router.post('/register', requireAdmin, async (req, res) => {
  try {
    const { name, phone, school } = req.body;
    if (!name || !phone) return res.status(400).json({ success: false, error: 'name + phone required' });
    const existing = await db().collection('ambassadors').get();
    const code = makeCode(name, existing.size);
    const norm = amb.normPhone(phone);
    let linkedPassengerId = null;
    for (const v of amb.phoneVariants(norm)) {
      try {
        const q = await db().collection('passengers').where('phone', '==', v).limit(1).get();
        if (!q.empty) { linkedPassengerId = q.docs[0].id; break; }
      } catch (_e) {}
    }
    const ref = await db().collection('ambassadors').add({
      code, name: String(name).trim(), phone: norm,
      school: String(school || '').trim(), active: true,
      totalOrders: 0, totalEarningsBalance: 0,
      linkedPassengerId,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.json({ success: true, id: ref.id, code, linkedPassengerId, walletLinked: !!linkedPassengerId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Ambassador login
router.post('/login', async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const phone = amb.normPhone(req.body.phone || '');
    if (!code || !phone) return res.status(400).json({ success: false, error: 'code + phone required' });
    const q = await db().collection('ambassadors').where('code', '==', code).limit(1).get();
    if (q.empty) return res.status(404).json({ success: false, error: 'Invalid code' });
    const doc = q.docs[0];
    const d = doc.data();
    if (d.active === false) return res.status(403).json({ success: false, error: 'Account deactivated' });
    if (amb.last9(d.phone) !== amb.last9(phone)) return res.status(401).json({ success: false, error: 'Phone does not match this code' });
    res.json({ success: true, ambassadorId: doc.id, code: d.code, name: d.name });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const ambassadorId = String(req.query.ambassadorId || '');
    if (!ambassadorId) return res.status(400).json({ success: false, error: 'ambassadorId required' });
    try { await amb.syncRecentOrders(150); } catch (_e) {}
    const stats = await amb.ambassadorStats(ambassadorId);
    if (!stats) return res.status(404).json({ success: false, error: 'Ambassador not found' });
    const ageDays = accountAgeDays(stats.amb);
    res.json({ success: true, ...stats, accountAgeDays: Math.floor(ageDays), escrowMode: ageDays < 7 ? 'week1-bodawallet' : 'week2-mpesa' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Request meal slot (1,2,3 in sequence)
router.post('/meal/request', async (req, res) => {
  try {
    const { ambassadorId, slot } = req.body;
    const s = parseInt(slot, 10);
    if (!ambassadorId || ![1, 2, 3].includes(s)) return res.status(400).json({ success: false, error: 'ambassadorId + slot (1/2/3) required' });
    const stats = await amb.ambassadorStats(ambassadorId);
    if (!stats) return res.status(404).json({ success: false, error: 'Ambassador not found' });
    if (stats.slots[s]) return res.status(400).json({ success: false, error: `Slot ${s} already ${stats.slots[s].status} this week (${stats.weekKey})` });
    if (s > 1 && !stats.slots[s - 1]) return res.status(400).json({ success: false, error: `Claim Slot ${s - 1} first (missed days can be claimed late, in order)` });
    const gate = s === 1 ? { ok: true } : amb.gateForSlot(s, stats.installs, stats.distinctOrderUsers);
    if (!gate.ok) return res.status(400).json({ success: false, error: gate.reason });
    const ref = await db().collection('ambassador_meal_claims').add({
      ambassadorId, weekKey: stats.weekKey, slot: s, amount: 150,
      status: 'requested', requestedAt: FieldValue.serverTimestamp(),
    });
    res.json({ success: true, claimId: ref.id, slot: s, weekKey: stats.weekKey, message: 'Sent to admin for approval' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Admin: meal queue
router.get('/admin/meals', requireAdmin, async (req, res) => {
  try {
    const q = await db().collection('ambassador_meal_claims').where('status', '==', 'requested').get();
    const list = [];
    for (const d of q.docs) {
      const c = { id: d.id, ...d.data() };
      const a = await db().collection('ambassadors').doc(c.ambassadorId).get();
      c.ambassador = a.exists ? { name: a.data().name, code: a.data().code, phone: a.data().phone } : null;
      list.push(c);
    }
    res.json({ success: true, pendingMeals: list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Admin: approve meal -> credits REAL BodaWallet
router.post('/admin/meals/approve', requireAdmin, async (req, res) => {
  try {
    const { claimId } = req.body;
    const csnap = await db().collection('ambassador_meal_claims').doc(String(claimId)).get();
    if (!csnap.exists) return res.status(404).json({ success: false, error: 'Claim not found' });
    const claim = csnap.data();
    if (claim.status !== 'requested') return res.status(400).json({ success: false, error: `Already ${claim.status}` });
    const asnap = await db().collection('ambassadors').doc(claim.ambassadorId).get();
    if (!asnap.exists) return res.status(404).json({ success: false, error: 'Ambassador not found' });
    const found = await amb.findPassengerForAmbassador({ ...asnap.data(), linkedPassengerId: asnap.data().linkedPassengerId });
    if (!found) return res.status(400).json({ success: false, error: 'No passenger wallet found for this ambassador phone. Ask them to register in the app with the same number first.' });
    try {
      await amb.creditPassengerWallet(found.ref, claim.amount || 150, `amb-meal-${csnap.id}`, 'ambassador_meal',
        { description: `Ambassador meal slot ${claim.slot} (${claim.weekKey})`, refId: csnap.id, ambassadorId: claim.ambassadorId });
    } catch (e) {
      if (String(e.message) === 'ALREADY_PROCESSED') {
        await csnap.ref.update({ status: 'approved', decidedAt: FieldValue.serverTimestamp() });
        return res.json({ success: true, alreadyCredited: true });
      }
      throw e;
    }
    await csnap.ref.update({ status: 'approved', decidedAt: FieldValue.serverTimestamp(), creditedPassengerId: found.id });
    await db().collection('ambassador_meals').add({ ambassadorId: claim.ambassadorId, weekKey: claim.weekKey, slot: claim.slot, amount: 150, claimId: csnap.id, claimedAt: FieldValue.serverTimestamp() });
    if (!asnap.data().linkedPassengerId) await asnap.ref.update({ linkedPassengerId: found.id });
    res.json({ success: true, creditedPassenger: found.id, amount: 150 });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/admin/meals/reject', requireAdmin, async (req, res) => {
  try {
    const { claimId } = req.body;
    await db().collection('ambassador_meal_claims').doc(String(claimId)).update({ status: 'rejected', decidedAt: FieldValue.serverTimestamp() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Withdraw from escrow (kind auto: week1 -> bodawallet, week2+ -> mpesa)
router.post('/request-payout', async (req, res) => {
  try {
    const { ambassadorId, amount, mpesaPhone } = req.body;
    const amt = Math.round(parseFloat(amount) || 0);
    if (!ambassadorId || !(amt > 0)) return res.status(400).json({ success: false, error: 'ambassadorId + amount required' });
    if (amt < 200) return res.status(400).json({ success: false, error: 'Minimum withdrawal is KES 200' });
    const stats = await amb.ambassadorStats(ambassadorId);
    if (!stats) return res.status(404).json({ success: false, error: 'Ambassador not found' });
    if (amt > stats.available) return res.status(400).json({ success: false, error: `Insufficient escrow. Available: ${stats.available}` });
    const age = accountAgeDays(stats.amb);
    const kind = age < 7 ? 'bodawallet' : 'mpesa';
    const ref = await db().collection('ambassador_payouts').add({
      ambassadorId, amount: amt, kind,
      mpesaPhone: amb.normPhone(mpesaPhone || stats.amb.phone),
      status: 'requested', requestedAt: FieldValue.serverTimestamp(),
    });
    res.json({ success: true, payoutId: ref.id, kind, message: kind === 'bodawallet' ? 'Week 1: goes to BodaWallet after admin approval' : 'Week 2+: admin will send M-Pesa after approval' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Admin: withdrawal queue (separate from meals)
router.get('/admin/payouts', requireAdmin, async (req, res) => {
  try {
    const q = await db().collection('ambassador_payouts').where('status', 'in', ['requested', 'approved']).get();
    const list = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ success: true, payouts: list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Admin: approve withdrawal. bodawallet -> auto-credit. mpesa approve -> approved (send manually) then paid.
router.post('/admin/payouts/decide', requireAdmin, async (req, res) => {
  try {
    const { payoutId, action } = req.body;
    if (!payoutId || !['approve', 'paid', 'reject'].includes(String(action))) return res.status(400).json({ success: false, error: 'payoutId + action (approve/paid/reject) required' });
    const psnap = await db().collection('ambassador_payouts').doc(String(payoutId)).get();
    if (!psnap.exists) return res.status(404).json({ success: false, error: 'Payout not found' });
    const p = psnap.data();
    if (action === 'reject') {
      await psnap.ref.update({ status: 'rejected', decidedAt: FieldValue.serverTimestamp() });
      return res.json({ success: true });
    }
    if (p.kind === 'bodawallet' && action === 'approve') {
      const asnap = await db().collection('ambassadors').doc(p.ambassadorId).get();
      const found = await amb.findPassengerForAmbassador({ ...asnap.data(), linkedPassengerId: asnap.data().linkedPassengerId });
      if (!found) return res.status(400).json({ success: false, error: 'No passenger wallet for this ambassador phone' });
      try {
        await amb.creditPassengerWallet(found.ref, p.amount, `amb-payout-${psnap.id}`, 'ambassador_escrow',
          { description: `Escrow withdrawal (Week 1)`, refId: psnap.id, ambassadorId: p.ambassadorId });
      } catch (e) { if (String(e.message) !== 'ALREADY_PROCESSED') throw e; }
      await psnap.ref.update({ status: 'approved', decidedAt: FieldValue.serverTimestamp(), creditedPassengerId: found.id });
      return res.json({ success: true, credited: true });
    }
    // mpesa flow
    const map = { approve: 'approved', paid: 'paid' };
    await psnap.ref.update({ status: map[action], decidedAt: FieldValue.serverTimestamp() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Manual credit one order
router.post('/sync-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const r = await amb.ensureCommissionForOrderId(String(orderId).trim());
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Admin overview (lighter: no full sync, per-amb stats)
router.get('/admin/overview', requireAdmin, async (req, res) => {
  try {
    const snap = await db().collection('ambassadors').get();
    const list = [];
    for (const d of snap.docs) {
      const s = await amb.ambassadorStats(d.id);
      list.push({
        id: d.id, code: s.amb.code, name: s.amb.name, phone: s.amb.phone, school: s.amb.school, active: s.amb.active !== false,
        installs: s.installs, validOrders: s.validOrders, orderUsers: s.distinctOrderUsers,
        activeReferrals: s.activeReferralCount, totalEarned: s.totalEarned, available: s.paidOut !== undefined ? s.available : 0,
        weekKey: s.weekKey, mealsUsed: s.mealsUsed, mealsLeft: s.mealsLeft,
        referrals: s.referrals.length,
      });
    }
    const meals = await db().collection('ambassador_meal_claims').where('status', '==', 'requested').get();
    const pays = await db().collection('ambassador_payouts').where('status', '==', 'requested').get();
    res.json({ success: true, ambassadors: list, pendingMeals: meals.size, pendingPayouts: pays.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/admin/toggle-active', requireAdmin, async (req, res) => {
  try {
    const { ambassadorId, active } = req.body;
    await db().collection('ambassadors').doc(String(ambassadorId)).update({ active: !!active });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;