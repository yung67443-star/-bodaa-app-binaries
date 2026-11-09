/**
 * Standalone Ambassador Routes - mounts at /api/ambassador
 * Does NOT depend on main backend. Same Firebase only.
 */
const express = require('express');
const admin = require('firebase-admin');
const amb = require('../services/ambassadorStandalone');

const router = express.Router();
const db = () => admin.firestore();

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

// Admin: create ambassador (generates code)
router.post('/register', requireAdmin, async (req, res) => {
  try {
    const { name, phone, school } = req.body;
    if (!name || !phone) return res.status(400).json({ success: false, error: 'name + phone required' });
    const existing = await db().collection('ambassadors').get();
    const code = makeCode(name, existing.size);
    const ref = await db().collection('ambassadors').add({
      code, name: String(name).trim(), phone: amb.normPhone(phone),
      school: String(school || '').trim(), active: true,
      totalOrders: 0, totalEarningsBalance: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true, id: ref.id, code });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Ambassador login: code + phone (no password for campus pilot)
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

// Ambassador dashboard (triggers background sync for freshness)
router.get('/dashboard', async (req, res) => {
  try {
    const ambassadorId = String(req.query.ambassadorId || '');
    if (!ambassadorId) return res.status(400).json({ success: false, error: 'ambassadorId required' });
    try { await amb.syncRecentOrders(300); } catch (_e) {}
    const stats = await amb.ambassadorStats(ambassadorId);
    if (!stats) return res.status(404).json({ success: false, error: 'Ambassador not found' });
    res.json({ success: true, ...stats });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Claim 1 free meal (150, max 3 per week Monday-Sunday Nairobi)
router.post('/claim-meal', async (req, res) => {
  try {
    const { ambassadorId } = req.body;
    if (!ambassadorId) return res.status(400).json({ success: false, error: 'ambassadorId required' });
    const stats = await amb.ambassadorStats(ambassadorId);
    if (!stats) return res.status(404).json({ success: false, error: 'Ambassador not found' });
    if (stats.mealsLeft <= 0) return res.status(400).json({ success: false, error: `Weekly limit reached (3x150). Resets Monday. Week: ${stats.weekKey}` });
    const ref = await db().collection('ambassador_meals').add({
      ambassadorId, weekKey: stats.weekKey, amount: 150,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true, mealId: ref.id, mealsLeft: stats.mealsLeft - 1, weekKey: stats.weekKey });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Request M-Pesa payout (>=200, from Week 2 = account older than 7 days)
router.post('/request-payout', async (req, res) => {
  try {
    const { ambassadorId, amount, mpesaPhone } = req.body;
    const amt = Math.round(parseFloat(amount) || 0);
    if (!ambassadorId || !(amt > 0)) return res.status(400).json({ success: false, error: 'ambassadorId + amount required' });
    if (amt < 200) return res.status(400).json({ success: false, error: 'Minimum withdrawal is KES 200' });
    const stats = await amb.ambassadorStats(ambassadorId);
    if (!stats) return res.status(404).json({ success: false, error: 'Ambassador not found' });
    // Week 2 rule
    const created = stats.amb.createdAt && stats.amb.createdAt.toDate ? stats.amb.createdAt.toDate() : null;
    if (created && (Date.now() - created.getTime()) < 7 * 86400000) {
      return res.status(400).json({ success: false, error: 'Payouts open from Week 2. Week 1 = food credit only.' });
    }
    if (amt > stats.available) return res.status(400).json({ success: false, error: `Insufficient balance. Available: ${stats.available}` });
    const ref = await db().collection('ambassador_payouts').add({
      ambassadorId, amount: amt, mpesaPhone: amb.normPhone(mpesaPhone || stats.amb.phone),
      status: 'requested', requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true, payoutId: ref.id, status: 'requested' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Manual: credit one order (admin or cron)
router.post('/sync-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });
    const r = await amb.ensureCommissionForOrderId(String(orderId).trim());
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Admin: overview of all ambassadors + probation flags + pending payouts
router.get('/admin/overview', requireAdmin, async (req, res) => {
  try {
    try { await amb.syncRecentOrders(400); } catch (_e) {}
    const snap = await db().collection('ambassadors').get();
    const list = [];
    for (const d of snap.docs) {
      const s = await amb.ambassadorStats(d.id);
      const msSinceLast = (() => {
        const t = s.commissions[0]?.orderTimestamp || s.commissions[0]?.createdAt?.toDate?.()?.getTime?.() || 0;
        return t ? Date.now() - Number(t) : 999 * 86400000;
      })();
      const probation = (s.referrals.length < 10 && msSinceLast > 10 * 86400000);
      list.push({
        id: d.id, code: s.amb.code, name: s.amb.name, phone: s.amb.phone, school: s.amb.school, active: s.amb.active !== false,
        referrals: s.referrals.length, activeReferrals: s.activeReferralCount,
        totalEarned: s.totalEarned, available: s.available,
        mealsUsed: s.mealsUsed, mealsLeft: s.mealsLeft, weekKey: s.weekKey,
        lastOrderDaysAgo: Math.floor(msSinceLast / 86400000),
        probation, commissions: s.commissions.slice(0, 10),
      });
    }
    const paySnap = await db().collection('ambassador_payouts').where('status', '==', 'requested').get();
    const pendingPayouts = paySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ success: true, ambassadors: list, pendingPayouts });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/admin/payout', requireAdmin, async (req, res) => {
  try {
    const { payoutId, action } = req.body; // approve | paid | reject
    if (!payoutId || !['approve', 'paid', 'reject', 'rejected'].includes(String(action))) {
      return res.status(400).json({ success: false, error: 'payoutId + action (approve/paid/reject) required' });
    }
    const map = { approve: 'approved', paid: 'paid', reject: 'rejected', rejected: 'rejected' };
    await db().collection('ambassador_payouts').doc(String(payoutId)).update({
      status: map[String(action)], decidedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
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
