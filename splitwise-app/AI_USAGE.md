# AI_USAGE.md — AI Collaboration Log

## Tool Used
**Claude (claude-sonnet-4-6)** by Anthropic — used as primary development collaborator via claude.ai.

---

## Key Prompts Used

1. "Help me design a SQLite schema for a shared expenses app where group membership changes over time — members join and leave, and expenses should only affect people who were members on that expense's date."

2. "Write a CSV importer in Node.js that detects these specific anomalies: [list of 17 anomalies from SCOPE.md]. For each anomaly, detect it, surface it in a report, and handle it per a documented policy. Don't silently ignore anything."

3. "Write the balance calculation logic. Use a greedy creditor-debtor matching algorithm to minimize the number of transactions. Aisha wants 'one number per person, who pays whom, how much, done.'"

4. "Build a React component for expense detail drilldown — clicking an expense shows exactly which splits make up the total. Rohan needs to trace his ₹2,300 balance back to specific rows."

---

## Three Cases Where AI Was Wrong

### Case 1: Percentage sum validation was off-by-one
**What AI produced:**
```js
if (totalPct !== 100) { /* flag */ }
```
**Problem:** Floating-point arithmetic means `30 + 30 + 30 + 20 = 110` but AI wrote exact equality check which would also incorrectly flag valid splits like `33.33 + 33.33 + 33.34 = 100.00` as invalid.

**What I changed:** Added a tolerance threshold:
```js
if (Math.abs(totalPct - 100) > 0.5) { /* flag */ }
```
This catches the Pizza Friday case (110%) while not false-flagging legitimate rounding.

---

### Case 2: Duplicate detection missed the Thalassa case
**What AI produced:** The initial duplicate detection only checked for exact (description + amount) matches. It missed the Thalassa case where two people logged the same dinner with *different* amounts.

**Problem:** The Thalassa case is a conflicting duplicate — same event, different amounts, one person's note says the other is wrong. The AI's exact-match logic skipped it entirely.

**What I changed:** Added a second pass — group by normalized description, and when multiple rows exist with different amounts, check the notes field for signals like "wrong" or "also logged this". Only then flag as CONFLICTING_DUPLICATE.

---

### Case 3: Sam's membership cutoff was applied too aggressively
**What AI produced:** The importer initially checked if Sam was in split_with for *any* expense before `2026-04-15` and removed him. But it also removed Sam from his own deposit row (April 8) and housewarming row (April 10), which are clearly Sam's own expenses.

**Problem:** Sam's deposit is Sam paying Aisha — Sam is the *payer*, not a recipient in a split. The AI checked `split_with` without distinguishing who was paying vs. who was splitting.

**What I changed:** The membership cutoff check applies only to the `split_with` array (who owes), not to `paid_by`. Sam can pay an expense even before his official join date (he was physically present). The join date only determines when he starts being liable for group expenses.
