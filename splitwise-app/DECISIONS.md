# DECISIONS.md — Engineering & Product Decision Log

## D1: Database — SQLite vs PostgreSQL

**Options considered:**
- SQLite (better-sqlite3)
- PostgreSQL
- MySQL

**Decision: SQLite**

**Reasoning:**
- Assignment says "relational DBs only" — SQLite qualifies
- Single-file deployment, no separate DB server needed for demo
- better-sqlite3 is synchronous, which simplifies transaction logic
- For a flat of 5 people with ~50 expenses/month, SQLite handles thousands of concurrent writes without issue
- Easily swappable to Postgres by changing the DB layer (same SQL)

**Tradeoff:** Not suitable if app scales to multi-tenant SaaS. Acceptable for this use case.

---

## D2: Currency conversion — fixed rate vs live API

**Options considered:**
- Live exchange rate API (e.g. open.er-api.com) per expense date
- Fixed rate stored at import time
- Rate stored per expense

**Decision: Fixed rate (83.5 INR/USD), stored per expense**

**Reasoning:**
- Priya's complaint is that $1 was treated as ₹1. Any rate is better than that.
- Live APIs require a key, add latency, can fail
- The trip was in March 2026. A reasonable mid-March rate is stored (83.5)
- Rate is stored on each expense row — if someone corrects the rate later, historical rows are unchanged
- `exchange_rates` table allows future rate lookups by date range

**Tradeoff:** Not perfectly accurate to daily rate. Documented. User can edit the exchange rate when adding USD expenses manually.

---

## D3: Duplicate detection — exact vs fuzzy

**Options considered:**
- Exact match (same description + date + amount)
- Fuzzy description match (Levenshtein distance)
- Manual review only

**Decision: Exact match for same amount, near-match for conflicting amounts + note analysis**

**Reasoning:**
- "dinner - marina bites" and "Dinner at Marina Bites" are caught by lowercased description comparison
- "Thalassa dinner" vs "Dinner at Thalassa" — caught by checking if both a simplified description and same participants exist with different amounts, and then the note explicitly says "hers is wrong"
- Fully fuzzy matching risks false positives (two separate dinners at the same restaurant)
- Note analysis ("wrong", "settlement not an expense") is reliable signal

---

## D4: Meera's request — approval workflow

**Options considered:**
- Full approval workflow (queue → user approves/rejects each flagged item)
- Flag + report (import runs, flags items, user reviews report)
- Don't delete anything automatically

**Decision: Flag in import report, require manual deletion for flagged items**

**Reasoning:**
- Full approval UI adds complexity that blocks the core import
- The import report lists every flagged row with "NEEDS REVIEW" badge
- Nothing is permanently deleted — duplicates are skipped (not inserted), original data stays in CSV
- User can manually delete any expense from the Expenses tab after reviewing

---

## D5: Split balance calculation — who owes whom

**Options considered:**
- Simple pair-wise (each person sees what they owe each other person, O(n²) transactions)
- Minimize transactions (greedy creditor/debtor matching)

**Decision: Minimize transactions (greedy)**

**Reasoning:**
- Aisha's request: "I just want one number per person. Who pays whom, how much, done."
- With 5 people, naive approach can have up to 10 transactions. Minimized: at most 4.
- Algorithm: sort creditors (positive net) and debtors (negative net), greedily match largest.
- Simple, well-understood, deterministic.

**Tradeoff:** Not always unique — multiple minimal solutions exist. This produces one valid one.

---

## D6: Sam's membership date

**Options considered:**
- Sam joins April 1 (with the group from start of month)
- Sam joins April 15 (when he actually moved in)

**Decision: April 15 per the CSV context**

**Reasoning:**
- Sam explicitly said: "I moved in mid-April. Why would March electricity affect my balance?"
- Row 37 (Sam's deposit) is dated April 8, row 38 (housewarming) April 10, row 40 (Electricity Apr) splits with Sam from April 12
- The data itself shows Sam appearing in splits from April 10 onwards
- `group_memberships.joined_at = 2026-04-15` — expenses before this date don't affect Sam

---

## D7: "Rohan's explainability" — Expense drilldown

**Options considered:**
- Show only net balance
- Show per-expense breakdown on click
- Show full transaction history in balance view

**Decision: Click-to-expand expense detail with full split breakdown**

**Reasoning:**
- Rohan: "If the app says I owe ₹2,300, I want to see exactly which expenses make that up."
- Each expense card opens a modal showing: who paid, amount, currency conversion if any, and a table of exactly who owes how much
- The import_row column links every imported expense back to its CSV line for full traceability

---

## D8: Authentication

**Options considered:**
- No auth (shared app, no login)
- Simple name-based login (no passwords)
- JWT with bcrypt passwords

**Decision: JWT with bcrypt**

**Reasoning:**
- Assignment explicitly requires a login module
- bcrypt is the standard for password hashing
- JWT is stateless, works well for React SPA
- Demo password (`password123`) pre-seeded for all users

---

## D9: Rounding

**Decision: Round all currency values to 2 decimal places at each split computation**

**Reasoning:**
- Floating-point errors accumulate. Rounding at the split level (not just display) prevents ₹0.01 phantom balances.
- INR doesn't use sub-paisa amounts.
- If splits don't perfectly sum to total (due to rounding), the difference is absorbed — this is standard practice (Splitwise does the same).
