const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// List all groups
router.get('/', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all();
  res.json(groups);
});

// Get group details with current members
router.get('/:id', (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const members = db.prepare(`
    SELECT gm.*, u.name, u.email, gm.joined_at, gm.left_at
    FROM group_memberships gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.joined_at
  `).all(req.params.id);

  res.json({ ...group, members });
});

// Create group
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
  res.json({ id: result.lastInsertRowid, name });
});

// Add member to group
router.post('/:id/members', (req, res) => {
  const { user_id, joined_at } = req.body;
  if (!user_id || !joined_at) return res.status(400).json({ error: 'user_id and joined_at required' });
  try {
    db.prepare('INSERT INTO group_memberships (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(req.params.id, user_id, joined_at);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Remove member from group (set left_at)
router.patch('/:id/members/:uid', (req, res) => {
  const { left_at } = req.body;
  db.prepare('UPDATE group_memberships SET left_at = ? WHERE group_id = ? AND user_id = ? AND left_at IS NULL').run(left_at, req.params.id, req.params.uid);
  res.json({ ok: true });
});

// Get group balances
router.get('/:id/balances', (req, res) => {
  const groupId = req.params.id;

  // Net balance per person: paid - owed
  const paid = db.prepare(`
    SELECT e.paid_by_name as name, SUM(e.amount_inr) as total_paid
    FROM expenses e
    WHERE e.group_id = ? AND e.is_settlement = 0
    GROUP BY e.paid_by_name
  `).all(groupId);

  const owed = db.prepare(`
    SELECT es.user_name as name, SUM(es.owed_amount) as total_owed
    FROM expense_splits es
    JOIN expenses e ON e.id = es.expense_id
    WHERE e.group_id = ? AND e.is_settlement = 0
    GROUP BY es.user_name
  `).all(groupId);

  // Settlements
  const settledFrom = db.prepare(`
    SELECT u.name, SUM(s.amount) as settled
    FROM settlements s JOIN users u ON u.id = s.from_user_id
    WHERE s.group_id = ? GROUP BY u.name
  `).all(groupId);

  const settledTo = db.prepare(`
    SELECT u.name, SUM(s.amount) as settled
    FROM settlements s JOIN users u ON u.id = s.to_user_id
    WHERE s.group_id = ? GROUP BY u.name
  `).all(groupId);

  const balances = {};
  paid.forEach(r => { balances[r.name] = (balances[r.name] || 0) + r.total_paid; });
  owed.forEach(r => { balances[r.name] = (balances[r.name] || 0) - r.total_owed; });
  settledFrom.forEach(r => { balances[r.name] = (balances[r.name] || 0) - r.settled; });
  settledTo.forEach(r => { balances[r.name] = (balances[r.name] || 0) + r.settled; });

  // Minimize transactions (greedy)
  const entries = Object.entries(balances).map(([name, net]) => ({ name, net: Math.round(net * 100) / 100 }));
  const transactions = minimizeTransactions(entries);

  res.json({ balances: entries, transactions });
});

function minimizeTransactions(entries) {
  const creditors = entries.filter(e => e.net > 0.01).sort((a, b) => b.net - a.net);
  const debtors = entries.filter(e => e.net < -0.01).sort((a, b) => a.net - b.net);
  const txns = [];
  let ci = 0, di = 0;
  const cred = creditors.map(e => ({ ...e }));
  const debt = debtors.map(e => ({ ...e }));
  while (ci < cred.length && di < debt.length) {
    const amount = Math.min(cred[ci].net, -debt[di].net);
    if (amount > 0.01) {
      txns.push({ from: debt[di].name, to: cred[ci].name, amount: Math.round(amount * 100) / 100 });
    }
    cred[ci].net -= amount;
    debt[di].net += amount;
    if (Math.abs(cred[ci].net) < 0.01) ci++;
    if (Math.abs(debt[di].net) < 0.01) di++;
  }
  return txns;
}

module.exports = router;
