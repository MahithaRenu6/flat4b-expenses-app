const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
  
  const user = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(name);
  if (!user) return res.status(401).json({ error: 'User not found' });
  
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  
  const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
  
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email || null, hash);
    const token = jwt.sign({ id: result.lastInsertRowid, name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: result.lastInsertRowid, name, email } });
  } catch (e) {
    res.status(400).json({ error: 'User already exists' });
  }
});

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, email FROM users ORDER BY name').all();
  res.json(users);
});

module.exports = router;
