# SCOPE.md — Anomaly Log & Database Schema

## Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT UNIQUE | |
| email | TEXT | nullable |
| password_hash | TEXT | bcrypt |
| created_at | TEXT | datetime |

### `groups`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | e.g. "Flat 4B" |
| created_at | TEXT | |

### `group_memberships`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| group_id | INTEGER FK → groups | |
| user_id | INTEGER FK → users | |
| joined_at | TEXT | YYYY-MM-DD |
| left_at | TEXT | nullable, YYYY-MM-DD |

This table is the core of "membership changes over time". An expense is checked against membership dates to determine if a person was active.

### `expenses`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| group_id | INTEGER FK → groups | |
| description | TEXT | |
| amount | REAL | Original amount in original currency |
| currency | TEXT | INR or USD |
| amount_inr | REAL | Always in INR (USD converted at rate) |
| exchange_rate | REAL | Rate used for conversion |
| paid_by_user_id | INTEGER FK → users | nullable (Unknown payer) |
| paid_by_name | TEXT | denormalized for display |
| expense_date | TEXT | YYYY-MM-DD |
| split_type | TEXT | equal/unequal/percentage/share |
| is_settlement | INTEGER | 0/1 |
| imported | INTEGER | 0/1 |
| import_row | INTEGER | CSV row number for traceability |
| notes | TEXT | |

### `expense_splits`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| expense_id | INTEGER FK → expenses | CASCADE delete |
| user_id | INTEGER FK → users | nullable |
| user_name | TEXT | denormalized |
| owed_amount | REAL | Always INR |
| share_units | REAL | for share split |
| percentage | REAL | for percentage split |

### `settlements`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| group_id | INTEGER FK | |
| from_user_id | INTEGER FK → users | who paid |
| to_user_id | INTEGER FK → users | who received |
| amount | REAL | |
| currency | TEXT | |
| settlement_date | TEXT | |
| notes | TEXT | |

### `exchange_rates`
Stores reference rates used at import time. Currently USD→INR = 83.5 (Mar 2026).

### `import_reports`
Full JSON anomaly log per import run.

---

## Anomaly Log — All 12+ Data Problems Found in expenses_export.csv

### ANOMALY 1: Exact duplicate row (Rows 4 & 5)
- **Row 4**: `dinner - marina bites` by Dev, ₹3200, 2026-02-08
- **Row 5**: Same dinner, same amount, same date — exact duplicate
- **Detection**: Description match (case-insensitive) + same amount
- **Policy**: Keep first occurrence (row 4). Skip row 5. Flag for user approval (Meera's request).

### ANOMALY 2: Same dinner, different amounts (Rows 23 & 24 — Thalassa)
- **Row 23**: `Dinner at Thalassa` by Aisha, ₹2400
- **Row 24**: `Thalassa dinner` by Rohan, ₹2450 — note says "Aisha also logged this I think hers is wrong"
- **Detection**: Near-duplicate description, different amount, note admits conflict
- **Policy**: Skip the row whose note says it's wrong (row 24/Aisha's). Keep Rohan's. Flag for review.

### ANOMALY 3: Settlement logged as expense (Row 13)
- `Rohan paid Aisha back`, ₹5000, notes say "this is a settlement not an expense??"
- **Detection**: Note contains "settlement not an expense"
- **Policy**: Convert to a `settlements` record, not an `expenses` record. Not counted in balances.

### ANOMALY 4: Amount with comma (Row 6)
- `Electricity Feb`, amount = `1,200` (string with comma, not numeric)
- **Detection**: parseFloat fails on raw string, but after stripping comma it parses
- **Policy**: Strip comma, parse as 1200. Log anomaly.

### ANOMALY 5: Percentage totals don't add to 100% (Row 14)
- `Pizza Friday`: Aisha 30% + Rohan 30% + Priya 30% + Meera 20% = 110%
- **Detection**: Sum of percentages != 100 (threshold: ±0.5%)
- **Policy**: Import as-is (total owed = ₹1584 on ₹1440 expense). Log anomaly. User must correct manually.

### ANOMALY 6: USD expenses treated as INR in original sheet (Rows 19, 20, 22)
- Priya: "Half the trip was in dollars. The sheet pretends a dollar is a rupee."
- Goa villa booking ($540), Beach shack ($84), Parasailing ($150)
- **Detection**: currency = USD
- **Policy**: Convert at 83.5 INR/USD (rate stored in exchange_rates table). Original USD amount and rate both stored.

### ANOMALY 7: Member who left still in split (Row 35)
- `Groceries BigBasket`, 2026-04-02, split_with includes Meera
- Meera left 2026-03-31
- **Detection**: Check split members against group_memberships.left_at for that expense date
- **Policy**: Remove Meera from split. Recalculate equal share among remaining members. Log anomaly.
- **Sam's concern addressed**: Sam's join date is 2026-04-15. Expenses before that date do not include Sam.

### ANOMALY 8: Non-standard date formats (Rows 15–26)
- Rows use DD/MM/YYYY (e.g. `01/03/2026`), some use `Mar 14` (text month)
- **Detection**: Fail ISO format check
- **Policy**: Parse all formats: ISO → DD/MM/YYYY → "Mon DD" → store as YYYY-MM-DD. Log each non-standard.

### ANOMALY 9: Ambiguous date (Row 33)
- Date `04/05/2026` — could be April 5 or May 4
- Note says "is this April 5 or May 4? format is a mess"
- **Detection**: Both day and month values ≤ 12 in a DD/MM/YYYY format
- **Policy**: Apply DD/MM/YYYY → May 4, 2026. Flag for manual review. Policy documented.

### ANOMALY 10: Missing currency (Row 27)
- `Groceries DMart`, 2026-03-15, currency = blank
- **Detection**: currency field empty after trim
- **Policy**: Default to INR (domestic grocery, INR context). Log anomaly.

### ANOMALY 11: Missing paid_by (Row 12)
- `House cleaning supplies`, notes: "can't remember who paid"
- **Detection**: paid_by is NaN/blank
- **Policy**: Set paid_by_name = 'Unknown'. Import expense. Require manual correction. Log anomaly.

### ANOMALY 12: External person in split (Row 22)
- `Parasailing` split_with includes "Dev's friend Kabir"
- Kabir is not a flat member
- **Detection**: Name not found in users table
- **Policy**: Remove Kabir from split. Note that Kabir's share is Dev's personal responsibility (Dev brought a guest). Log anomaly.

### ANOMALY 13: Zero amount (Row 30)
- `Dinner order Swiggy`, amount = 0, note says "counted twice earlier - fixing later"
- **Detection**: amount == 0
- **Policy**: SKIP. Zero-amount expense has no financial effect. Log anomaly.

### ANOMALY 14: split_type missing / NaN (Row 13 — settlement row)
- split_type = NaN for settlement row
- **Detection**: split_type blank or "nan"
- **Policy**: Row is already handled as a settlement. Other blank split_type rows are skipped.

### ANOMALY 15: split_type=equal but share details present (Row 41)
- `Furniture for common room`, split_type=equal, but split_details has "Aisha 1; Rohan 1; Priya 1; Sam 1"
- Note says "someone added shares anyway"
- **Detection**: split_type is equal AND split_details contains numeric values
- **Policy**: Treat as equal split (split_type wins). The share values happen to produce equal result anyway. Log anomaly.

### ANOMALY 16: Name inconsistencies
- `priya` (lowercase), `Priya S` (initial), `rohan` (lowercase)
- **Detection**: case-insensitive lookup, known aliases mapped
- **Policy**: Normalize via NAME_MAP. `Priya S` → `Priya`. All lowercased names title-cased.

### ANOMALY 17: Parasailing refund (Row 25)
- `Parasailing refund`, amount = -$30
- **Detection**: amount < 0
- **Policy**: Treated as a refund/credit. Imported with negative amount_inr. This correctly reduces what members owe for the trip.
