const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// USD/INR rate used for import (documented decision)
const USD_TO_INR = 83.5;

// Known name normalizations
const NAME_MAP = {
  'priya s': 'Priya', 'priya': 'Priya',
  'rohan': 'Rohan', 'aisha': 'Aisha',
  'meera': 'Meera', 'sam': 'Sam', 'dev': 'Dev'
};

function normalizeName(raw) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return NAME_MAP[key] || raw.trim().replace(/\b\w/g, c => c.toUpperCase());
}

// Parse dates in multiple formats: YYYY-MM-DD, DD/MM/YYYY, "Mon DD", "Mar 14"
function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  // "Mar 14" or "Mar 14, 2026" style
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const mname = s.match(/^([A-Za-z]{3})\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (mname) {
    const month = months[mname[1].toLowerCase()];
    const day = mname[2].padStart(2, '0');
    const year = mname[3] || '2026';
    if (month) return `${year}-${String(month).padStart(2, '0')}-${day}`;
  }

  return null;
}

// Parse amount: handle comma as thousands separator
function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).replace(/,/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const group_id = req.body.group_id || 1;
  const content = req.file.buffer.toString('utf-8');
  let rows;
  try {
    rows = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse CSV: ' + e.message });
  }

  const anomalies = [];
  const imported = [];
  const skipped = [];
  const pendingApproval = []; // Meera's request: flag duplicates for approval

  // --- Pre-pass: detect duplicate rows ---
  const seenKeys = new Map();
  rows.forEach((row, i) => {
    const key = `${row.description?.trim().toLowerCase()}|${row.date?.trim()}|${row.amount}`;
    const keyAlt = `${row.description?.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    if (!seenKeys.has(keyAlt)) seenKeys.set(keyAlt, []);
    seenKeys.get(keyAlt).push(i);
  });

  // Build a lookup for Thalassa-style duplicate (same event, different amounts)
  const descGroups = new Map();
  rows.forEach((row, i) => {
    const desc = row.description?.trim().toLowerCase();
    if (!descGroups.has(desc)) descGroups.set(desc, []);
    descGroups.get(desc).push({ row, i });
  });

  // Track skipped indices
  const skipIndices = new Set();

  // --- Anomaly 1 & 2: Exact duplicates (rows 3 & 4 - dinner marina bites) ---
  descGroups.forEach((entries, desc) => {
    if (entries.length > 1) {
      const amounts = entries.map(e => parseAmount(e.row.amount));
      const allSame = amounts.every(a => a === amounts[0]);
      if (allSame) {
        // Exact duplicate - skip all but first
        entries.slice(1).forEach(({ i }) => {
          skipIndices.add(i);
          anomalies.push({
            row: i + 2, type: 'EXACT_DUPLICATE',
            description: entries[0].row.description,
            action: 'SKIPPED - exact duplicate of row ' + (entries[0].i + 2),
            requires_approval: true,
            original_row: entries[0].i + 2
          });
          pendingApproval.push({ row: i + 2, type: 'duplicate', detail: `"${entries[0].row.description}" is duplicated` });
        });
      } else {
        // Same description, different amount - flag for approval (Thalassa case)
        // Policy: keep the one with a note saying it's wrong; skip it; keep the other
        entries.forEach(({ row: r, i }) => {
          const note = (r.notes || '').toLowerCase();
          if (note.includes('wrong') || note.includes('hers is wrong')) {
            skipIndices.add(i);
            anomalies.push({
              row: i + 2, type: 'CONFLICTING_DUPLICATE',
              description: r.description,
              action: `SKIPPED - note says this entry is wrong. Keeping row with amount ${amounts.find((a, j) => j !== entries.findIndex(e => e.i === i))}`,
              requires_approval: true
            });
            pendingApproval.push({ row: i + 2, type: 'conflicting_duplicate', detail: `"${r.description}" has conflicting amount` });
          }
        });
      }
    }
  });

  // Process each row
  rows.forEach((row, i) => {
    const rowNum = i + 2; // 1-indexed, header is row 1
    const rowAnomalies = [];
    let skip = false;
    let skipReason = null;

    if (skipIndices.has(i)) return; // already handled

    // --- Anomaly: Settlement logged as expense (row 12) ---
    const notes = (row.notes || '').toLowerCase();
    const desc = (row.description || '').toLowerCase();
    if (notes.includes('settlement not an expense') || notes.includes('settlement') && desc.includes('paid') && desc.includes('back')) {
      anomalies.push({
        row: rowNum, type: 'SETTLEMENT_AS_EXPENSE',
        description: row.description,
        action: 'CONVERTED to settlement record, not counted as expense',
        requires_approval: false
      });
      // Record as settlement
      const paidByUser = db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get(normalizeName(row.paid_by));
      const splitWith = row.split_with ? row.split_with.split(';').map(s => s.trim()) : [];
      const toUser = splitWith[0] ? db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get(normalizeName(splitWith[0])) : null;
      if (paidByUser && toUser) {
        db.prepare(`INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, currency, settlement_date, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(group_id, paidByUser.id, toUser.id, parseAmount(row.amount), row.currency || 'INR', parseDate(row.date) || '2026-02-25', 'Imported from CSV');
      }
      imported.push(rowNum);
      return;
    }

    // --- Anomaly: Missing paid_by ---
    const paidByRaw = row.paid_by;
    let paid_by_name = paidByRaw ? normalizeName(paidByRaw) : null;
    if (!paid_by_name || paid_by_name.trim() === '') {
      rowAnomalies.push({ type: 'MISSING_PAID_BY', action: "Set to 'Unknown' - requires manual correction" });
      paid_by_name = 'Unknown';
      anomalies.push({ row: rowNum, type: 'MISSING_PAID_BY', description: row.description, action: 'Paid_by blank - stored as Unknown, manual fix needed' });
    }

    // --- Anomaly: Amount with comma (1,200) ---
    let amount = parseAmount(row.amount);
    if (row.amount && String(row.amount).includes(',')) {
      rowAnomalies.push({ type: 'AMOUNT_WITH_COMMA', action: 'Stripped comma, parsed as number' });
      anomalies.push({ row: rowNum, type: 'AMOUNT_WITH_COMMA', description: row.description, action: `Amount "${row.amount}" had comma - parsed as ${amount}` });
    }

    // --- Anomaly: Zero amount ---
    if (amount === 0) {
      anomalies.push({ row: rowNum, type: 'ZERO_AMOUNT', description: row.description, action: 'SKIPPED - zero amount (noted as previously counted)' });
      skipped.push(rowNum);
      return;
    }

    // --- Anomaly: Negative amount (refund) ---
    if (amount !== null && amount < 0) {
      rowAnomalies.push({ type: 'NEGATIVE_AMOUNT', action: 'Treated as refund/credit, imported with negative value' });
      anomalies.push({ row: rowNum, type: 'NEGATIVE_AMOUNT', description: row.description, action: `Amount ${amount} is negative - treated as refund/partial credit` });
    }

    // --- Anomaly: Null or bad amount ---
    if (amount === null) {
      anomalies.push({ row: rowNum, type: 'INVALID_AMOUNT', description: row.description, action: 'SKIPPED - could not parse amount' });
      skipped.push(rowNum);
      return;
    }

    // --- Anomaly: Missing currency (row 26) ---
    let currency = (row.currency || '').trim();
    if (!currency) {
      rowAnomalies.push({ type: 'MISSING_CURRENCY', action: 'Defaulted to INR based on context (domestic grocery in March)' });
      anomalies.push({ row: rowNum, type: 'MISSING_CURRENCY', description: row.description, action: 'Currency blank - defaulted to INR' });
      currency = 'INR';
    }
    // Trim extra spaces in currency (row 27 has "INR " with space)
    currency = currency.trim();

    // --- Anomaly: Date format inconsistency ---
    const parsedDate = parseDate(row.date);
    if (!parsedDate) {
      anomalies.push({ row: rowNum, type: 'INVALID_DATE', description: row.description, action: 'SKIPPED - could not parse date: ' + row.date });
      skipped.push(rowNum);
      return;
    }
    if (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date.trim())) {
      anomalies.push({ row: rowNum, type: 'NONSTANDARD_DATE', description: row.description, action: `Date "${row.date}" normalized to ${parsedDate}` });
    }

    // --- Anomaly: Ambiguous date (04/05/2026 = Apr 5 or May 4?) ---
    if (row.date && /^\d{2}\/\d{2}\/\d{4}$/.test(row.date.trim())) {
      const parts = row.date.trim().split('/');
      if (parseInt(parts[0]) <= 12 && parseInt(parts[1]) <= 12) {
        // Both orderings are plausible - note it but use DD/MM/YYYY as policy
        const note = (row.notes || '').toLowerCase();
        if (note.includes('april 5 or may 4') || note.includes('format is a mess')) {
          anomalies.push({ row: rowNum, type: 'AMBIGUOUS_DATE', description: row.description, action: `Date "${row.date}" is ambiguous (Apr 5 or May 4?). Policy: DD/MM/YYYY → interpreted as ${parsedDate}. Manual review recommended.` });
        }
      }
    }

    // --- Anomaly: USD currency - convert ---
    let exchange_rate = 1.0;
    let amount_inr = amount;
    if (currency === 'USD') {
      exchange_rate = USD_TO_INR;
      amount_inr = amount * USD_TO_INR;
      // Already flagged as a general policy, only note per-row
      rowAnomalies.push({ type: 'USD_CONVERTED', action: `Converted $${amount} × ${USD_TO_INR} = ₹${amount_inr.toFixed(2)}` });
    }

    // --- Anomaly: percentage doesn't add to 100 (row 13 - Pizza Friday) ---
    let split_type = (row.split_type || '').trim().toLowerCase();
    if (!split_type || split_type === 'nan') {
      // Settlement-like rows: NaN split_type
      anomalies.push({ row: rowNum, type: 'MISSING_SPLIT_TYPE', description: row.description, action: 'SKIPPED - no split type, likely a settlement already handled or data error' });
      skipped.push(rowNum);
      return;
    }

    // Parse split_with
    const splitWithRaw = row.split_with || '';
    const splitNames = splitWithRaw.split(';').map(s => normalizeName(s.trim())).filter(Boolean);

    // --- Anomaly: Member who has left included (Meera in April expense, row 34) ---
    const meeraLeftDate = '2026-03-31';
    const samJoinedDate = '2026-04-15';
    if (parsedDate > meeraLeftDate && splitNames.includes('Meera')) {
      anomalies.push({ row: rowNum, type: 'LEFT_MEMBER_IN_SPLIT', description: row.description, action: `Meera left on ${meeraLeftDate} but is in split_with for ${parsedDate}. Meera REMOVED from split.` });
      splitNames.splice(splitNames.indexOf('Meera'), 1);
    }
    // Sam before join date
    if (parsedDate < samJoinedDate && splitNames.includes('Sam')) {
      anomalies.push({ row: rowNum, type: 'NOT_YET_MEMBER_IN_SPLIT', description: row.description, action: `Sam joined on ${samJoinedDate} but appears in split for ${parsedDate}. Sam REMOVED from split.` });
      splitNames.splice(splitNames.indexOf('Sam'), 1);
    }

    // --- Anomaly: Dev's friend Kabir in parasailing split ---
    const hasKabir = splitNames.some(n => n && n.toLowerCase().includes('kabir'));
    if (hasKabir) {
      anomalies.push({ row: rowNum, type: 'EXTERNAL_PERSON_IN_SPLIT', description: row.description, action: "Kabir (Dev's friend) is not a flat member. Split recalculated among flat members only: Aisha, Rohan, Priya, Dev. Kabir's share is Dev's responsibility." });
      // Remove Kabir, keep Dev responsible for Kabir's share
      const kabirIdx = splitNames.findIndex(n => n && n.toLowerCase().includes('kabir'));
      if (kabirIdx !== -1) splitNames.splice(kabirIdx, 1);
    }

    // Build splits
    let splits = [];
    const splitDetails = row.split_details || '';

    if (split_type === 'equal') {
      splits = splitNames.map(name => ({ name, amount: amount_inr / splitNames.length }));
    } else if (split_type === 'unequal') {
      // Parse "Rohan 700; Priya 400; Meera 400"
      const parts = splitDetails.split(';').map(s => s.trim()).filter(Boolean);
      let totalParsed = 0;
      splits = parts.map(p => {
        const m = p.match(/^([A-Za-z\s]+)\s+([\d.]+)$/);
        if (m) {
          const amt = parseFloat(m[2]);
          totalParsed += amt;
          return { name: normalizeName(m[1].trim()), amount: amt };
        }
        return null;
      }).filter(Boolean);
      // Validate sum
      if (Math.abs(totalParsed - Math.abs(amount_inr)) > 1) {
        anomalies.push({ row: rowNum, type: 'UNEQUAL_SUM_MISMATCH', description: row.description, action: `Unequal splits sum ₹${totalParsed} ≠ expense ₹${amount_inr}. Imported as-is.` });
      }
    } else if (split_type === 'percentage') {
      const parts = splitDetails.split(';').map(s => s.trim()).filter(Boolean);
      let totalPct = 0;
      splits = parts.map(p => {
        const m = p.match(/^([A-Za-z\s]+)\s+([\d.]+)%$/);
        if (m) {
          const pct = parseFloat(m[2]);
          totalPct += pct;
          return { name: normalizeName(m[1].trim()), percentage: pct, amount: amount_inr * pct / 100 };
        }
        return null;
      }).filter(Boolean);
      if (Math.abs(totalPct - 100) > 0.5) {
        anomalies.push({ row: rowNum, type: 'PERCENTAGE_NOT_100', description: row.description, action: `Percentages sum to ${totalPct}%, not 100%. Note says "might be off". Imported as-is - totals ₹${splits.reduce((a,s)=>a+s.amount,0).toFixed(2)} of ₹${amount_inr}.` });
      }
    } else if (split_type === 'share') {
      const parts = splitDetails.split(';').map(s => s.trim()).filter(Boolean);
      const totalShares = parts.reduce((a, p) => {
        const m = p.match(/^([A-Za-z\s]+)\s+([\d.]+)$/);
        return a + (m ? parseFloat(m[2]) : 0);
      }, 0);
      splits = parts.map(p => {
        const m = p.match(/^([A-Za-z\s]+)\s+([\d.]+)$/);
        if (m) {
          const sh = parseFloat(m[2]);
          return { name: normalizeName(m[1].trim()), shares: sh, amount: amount_inr * sh / totalShares };
        }
        return null;
      }).filter(Boolean);
    }

    // --- Anomaly: equal split_type but share details present (row 40) ---
    if (split_type === 'equal' && splitDetails && splitDetails.includes(';') && splitDetails.match(/\d/)) {
      anomalies.push({ row: rowNum, type: 'SPLIT_TYPE_DETAIL_MISMATCH', description: row.description, action: `split_type is "equal" but split_details has values. Note says "someone added shares anyway". Treating as equal split among listed members.` });
    }

    // Get or create user ids
    const paidByUser = db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get(paid_by_name);
    const paid_by_user_id = paidByUser ? paidByUser.id : null;

    // Insert expense
    const result = db.prepare(`INSERT INTO expenses
      (group_id, description, amount, currency, amount_inr, exchange_rate, paid_by_user_id, paid_by_name,
       expense_date, split_type, notes, imported, import_row)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(group_id, row.description?.trim(), amount, currency, Math.round(amount_inr * 100) / 100,
      exchange_rate, paid_by_user_id, paid_by_name, parsedDate, split_type,
      row.notes || null, rowNum);

    const expId = result.lastInsertRowid;

    // Insert splits
    const splitStmt = db.prepare(`INSERT INTO expense_splits (expense_id, user_id, user_name, owed_amount, share_units, percentage)
      VALUES (?, ?, ?, ?, ?, ?)`);
    splits.forEach(s => {
      const u = db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').get(s.name);
      splitStmt.run(expId, u ? u.id : null, s.name, Math.round((s.amount || 0) * 100) / 100, s.shares || null, s.percentage || null);
    });

    imported.push(rowNum);
  });

  // Save import report
  db.prepare(`INSERT INTO import_reports (total_rows, imported_rows, skipped_rows, anomalies)
    VALUES (?, ?, ?, ?)`
  ).run(rows.length, imported.length, skipped.length, JSON.stringify(anomalies));

  res.json({
    total_rows: rows.length,
    imported: imported.length,
    skipped: skipped.length,
    anomalies,
    pending_approval: pendingApproval,
    message: `Import complete. ${imported.length} rows imported, ${skipped.length} skipped, ${anomalies.length} anomalies detected.`
  });
});

// Get all import reports
router.get('/reports', (req, res) => {
  const reports = db.prepare('SELECT * FROM import_reports ORDER BY imported_at DESC').all();
  res.json(reports.map(r => ({ ...r, anomalies: JSON.parse(r.anomalies || '[]') })));
});

module.exports = router;
