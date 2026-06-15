const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// List expenses for a group
router.get('/', (req, res) => {
  const { group_id } = req.query;
  let q = `SELECT e.*, GROUP_CONCAT(es.user_name || ':' || es.owed_amount, '|') as splits_raw
    FROM expenses e
    LEFT JOIN expense_splits es ON es.expense_id = e.id
    WHERE e.is_settlement = 0`;
  const params = [];
  if (group_id) { q += ' AND e.group_id = ?'; params.push(group_id); }
  q += ' GROUP BY e.id ORDER BY e.expense_date DESC, e.id DESC';
  const rows = db.prepare(q).all(...params);
  res.json(rows.map(r => ({
    ...r,
    splits: r.splits_raw ? r.splits_raw.split('|').map(s => { const [name, amt] = s.split(':'); return { name, amount: parseFloat(amt) }; }) : []
  })));
});

// Get single expense with splits
router.get('/:id', (req, res) => {
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Not found' });
  const splits = db.prepare('SELECT * FROM expense_splits WHERE expense_id = ?').all(req.params.id);
  res.json({ ...exp, splits });
});

// Create expense
router.post('/', (req, res) => {
  const { group_id, description, amount, currency, exchange_rate, paid_by_user_id, paid_by_name, expense_date, split_type, splits, notes } = req.body;
  if (!description || !amount || !paid_by_name || !expense_date || !split_type)
    return res.status(400).json({ error: 'Missing required fields' });

  const rate = exchange_rate || 1.0;
  const amount_inr = currency === 'INR' ? amount : amount * rate;

  const result = db.prepare(`INSERT INTO expenses 
    (group_id, description, amount, currency, amount_inr, exchange_rate, paid_by_user_id, paid_by_name, expense_date, split_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(group_id || null, description, amount, currency || 'INR', amount_inr, rate, paid_by_user_id || null, paid_by_name, expense_date, split_type, notes || null);

  const expId = result.lastInsertRowid;
  insertSplits(expId, splits, amount_inr, split_type);
  res.json({ id: expId });
});

// Update expense
router.put('/:id', (req, res) => {
  const { description, amount, currency, exchange_rate, paid_by_user_id, paid_by_name, expense_date, split_type, splits, notes } = req.body;
  const rate = exchange_rate || 1.0;
  const amount_inr = currency === 'INR' ? amount : amount * rate;

  db.prepare(`UPDATE expenses SET description=?, amount=?, currency=?, amount_inr=?, exchange_rate=?,
    paid_by_user_id=?, paid_by_name=?, expense_date=?, split_type=?, notes=? WHERE id=?`
  ).run(description, amount, currency || 'INR', amount_inr, rate, paid_by_user_id || null, paid_by_name, expense_date, split_type, notes || null, req.params.id);

  db.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(req.params.id);
  insertSplits(req.params.id, splits, amount_inr, split_type);
  res.json({ ok: true });
});

// Delete expense
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Settlements list
router.get('/settlements/list', (req, res) => {
  const { group_id } = req.query;
  let q = `SELECT s.*, uf.name as from_name, ut.name as to_name FROM settlements s
    JOIN users uf ON uf.id = s.from_user_id
    JOIN users ut ON ut.id = s.to_user_id`;
  const params = [];
  if (group_id) { q += ' WHERE s.group_id = ?'; params.push(group_id); }
  q += ' ORDER BY s.settlement_date DESC';
  res.json(db.prepare(q).all(...params));
});

// Record settlement
router.post('/settlements', (req, res) => {
  const { group_id, from_user_id, to_user_id, amount, currency, settlement_date, notes } = req.body;
  const result = db.prepare(`INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, currency, settlement_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(group_id || null, from_user_id, to_user_id, amount, currency || 'INR', settlement_date, notes || null);
  res.json({ id: result.lastInsertRowid });
});

function insertSplits(expId, splits, amount_inr, split_type) {
  if (!splits || splits.length === 0) return;
  const stmt = db.prepare(`INSERT INTO expense_splits (expense_id, user_id, user_name, owed_amount, share_units, percentage)
    VALUES (?, ?, ?, ?, ?, ?)`);

  if (split_type === 'equal') {
    const each = amount_inr / splits.length;
    splits.forEach(s => stmt.run(expId, s.user_id || null, s.name, Math.round(each * 100) / 100, null, null));
  } else if (split_type === 'unequal') {
    splits.forEach(s => stmt.run(expId, s.user_id || null, s.name, s.amount, null, null));
  } else if (split_type === 'percentage') {
    splits.forEach(s => stmt.run(expId, s.user_id || null, s.name, Math.round(amount_inr * s.percentage / 100 * 100) / 100, null, s.percentage));
  } else if (split_type === 'share') {
    const totalShares = splits.reduce((a, s) => a + s.shares, 0);
    splits.forEach(s => stmt.run(expId, s.user_id || null, s.name, Math.round(amount_inr * s.shares / totalShares * 100) / 100, s.shares, null));
  }
}

module.exports = router;
