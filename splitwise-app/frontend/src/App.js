import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API = '';
function api(path, opts = {}) {
  const token = localStorage.getItem('token');
  return fetch(API + '/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...opts,
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
  }).then(r => r.json());
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('login');

  const submit = async () => {
    const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
    const r = await api(endpoint, { method: 'POST', body: { name, password: pass } });
    if (r.token) { localStorage.setItem('token', r.token); onLogin(r.user); }
    else setErr(r.error || 'Failed');
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>🏠 Flat 4B Expenses</h1>
        <p className="login-sub">Shared expenses tracker</p>
        <div className="field"><label>Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Aisha, Rohan, Priya…" /></div>
        <div className="field"><label>Password</label><input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="password123" /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn-primary" onClick={submit}>{mode === 'login' ? 'Login' : 'Register'}</button>
        <button className="btn-link" onClick={() => setMode(m => m === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New user? Register' : 'Have account? Login'}
        </button>
        <div className="demo-creds">Demo: any name (Aisha/Rohan/Priya/Meera/Sam/Dev) → password123</div>
      </div>
    </div>
  );
}

// ─── NAV ─────────────────────────────────────────────────────────────────────
function Nav({ user, page, setPage, onLogout }) {
  const pages = ['Dashboard', 'Expenses', 'Import', 'Settlements', 'Members'];
  return (
    <nav className="nav">
      <span className="nav-brand">🏠 Flat 4B</span>
      <div className="nav-links">
        {pages.map(p => <button key={p} className={page === p ? 'nav-btn active' : 'nav-btn'} onClick={() => setPage(p)}>{p}</button>)}
      </div>
      <span className="nav-user">{user.name} <button className="btn-link" onClick={onLogout}>Logout</button></span>
    </nav>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ groupId }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => api('/groups/' + groupId + '/balances').then(setData), [groupId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="loading">Loading balances…</div>;

  const pos = data.balances.filter(b => b.net > 0.01);
  const neg = data.balances.filter(b => b.net < -0.01);
  const even = data.balances.filter(b => Math.abs(b.net) <= 0.01);

  return (
    <div className="page">
      <h2>Balance Summary</h2>
      <div className="balance-grid">
        {pos.length > 0 && <div className="balance-section">
          <h3 className="green-head">💰 Owed back</h3>
          {pos.map(b => <div key={b.name} className="balance-row pos"><span>{b.name}</span><span>+₹{b.net.toFixed(2)}</span></div>)}
        </div>}
        {neg.length > 0 && <div className="balance-section">
          <h3 className="red-head">💸 Owes money</h3>
          {neg.map(b => <div key={b.name} className="balance-row neg"><span>{b.name}</span><span>₹{b.net.toFixed(2)}</span></div>)}
        </div>}
        {even.length > 0 && <div className="balance-section">
          <h3>✅ Settled up</h3>
          {even.map(b => <div key={b.name} className="balance-row">{b.name}</div>)}
        </div>}
      </div>
      {data.transactions.length > 0 && <>
        <h2>Suggested Settlements</h2>
        <div className="txn-list">
          {data.transactions.map((t, i) => (
            <div key={i} className="txn-row">
              <span className="txn-from">{t.from}</span>
              <span className="txn-arrow">→ pays →</span>
              <span className="txn-to">{t.to}</span>
              <span className="txn-amt">₹{t.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <p className="note">These are the minimum transactions to settle all debts.</p>
      </>}
    </div>
  );
}

// ─── EXPENSE LIST ────────────────────────────────────────────────────────────
function Expenses({ groupId, users }) {
  const [expenses, setExpenses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => api('/expenses?group_id=' + groupId).then(setExpenses), [groupId]);
  useEffect(() => { load(); }, [load]);

  const del = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await api('/expenses/' + id, { method: 'DELETE' });
    load();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Expenses</h2>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ Add Expense</button>
      </div>

      {(showForm || editing) && (
        <ExpenseForm groupId={groupId} users={users} expense={editing}
          onSave={() => { setShowForm(false); setEditing(null); load(); }}
          onCancel={() => { setShowForm(false); setEditing(null); }} />
      )}

      {detail && <ExpenseDetail expense={detail} onClose={() => setDetail(null)} />}

      <div className="expense-list">
        {expenses.map(e => (
          <div key={e.id} className="expense-card" onClick={() => setDetail(e)}>
            <div className="exp-date">{e.expense_date}</div>
            <div className="exp-desc">{e.description}</div>
            <div className="exp-meta">Paid by <strong>{e.paid_by_name}</strong></div>
            <div className="exp-amount">
              {e.currency !== 'INR' && <span className="orig-amt">{e.currency} {e.amount}</span>}
              <span>₹{e.amount_inr?.toFixed(2)}</span>
            </div>
            <div className="exp-split">{e.split_type}</div>
            <div className="exp-actions" onClick={ev => ev.stopPropagation()}>
              <button className="btn-sm" onClick={() => { setEditing(e); setShowForm(false); }}>Edit</button>
              <button className="btn-sm danger" onClick={() => del(e.id)}>Delete</button>
            </div>
          </div>
        ))}
        {expenses.length === 0 && <div className="empty">No expenses yet. Import CSV or add manually.</div>}
      </div>
    </div>
  );
}

function ExpenseDetail({ expense, onClose }) {
  const [splits, setSplits] = useState([]);
  useEffect(() => {
    api('/expenses/' + expense.id).then(d => setSplits(d.splits || []));
  }, [expense.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h3>{expense.description}</h3>
        <div className="detail-grid">
          <div><label>Date</label><span>{expense.expense_date}</span></div>
          <div><label>Paid by</label><span>{expense.paid_by_name}</span></div>
          <div><label>Amount</label><span>₹{expense.amount_inr?.toFixed(2)}{expense.currency !== 'INR' && ` (${expense.currency} ${expense.amount} × ${expense.exchange_rate})`}</span></div>
          <div><label>Split type</label><span>{expense.split_type}</span></div>
          {expense.notes && <div className="full"><label>Notes</label><span>{expense.notes}</span></div>}
        </div>
        <h4>Split breakdown</h4>
        <table className="split-table">
          <thead><tr><th>Person</th><th>Owes</th></tr></thead>
          <tbody>
            {splits.map(s => <tr key={s.id}><td>{s.user_name}</td><td>₹{s.owed_amount?.toFixed(2)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── EXPENSE FORM ─────────────────────────────────────────────────────────────
function ExpenseForm({ groupId, users, expense, onSave, onCancel }) {
  const [desc, setDesc] = useState(expense?.description || '');
  const [amount, setAmount] = useState(expense?.amount || '');
  const [currency, setCurrency] = useState(expense?.currency || 'INR');
  const [rate, setRate] = useState(expense?.exchange_rate || 83.5);
  const [paidBy, setPaidBy] = useState(expense?.paid_by_name || '');
  const [date, setDate] = useState(expense?.expense_date || new Date().toISOString().split('T')[0]);
  const [splitType, setSplitType] = useState(expense?.split_type || 'equal');
  const [selectedMembers, setSelectedMembers] = useState(
    expense?.splits?.map(s => s.name) || users.slice(0, 4).map(u => u.name)
  );
  const [unequalAmts, setUnequalAmts] = useState({});
  const [percentages, setPercentages] = useState({});
  const [shareUnits, setShareUnits] = useState({});
  const [notes, setNotes] = useState(expense?.notes || '');
  const [err, setErr] = useState('');

  const toggleMember = (name) => {
    setSelectedMembers(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const buildSplits = () => {
    const amtNum = parseFloat(amount);
    const amtInr = currency === 'INR' ? amtNum : amtNum * parseFloat(rate);
    return selectedMembers.map(name => {
      const u = users.find(u => u.name === name);
      if (splitType === 'equal') return { name, user_id: u?.id, amount: amtInr / selectedMembers.length };
      if (splitType === 'unequal') return { name, user_id: u?.id, amount: parseFloat(unequalAmts[name] || 0) };
      if (splitType === 'percentage') return { name, user_id: u?.id, percentage: parseFloat(percentages[name] || 0), amount: amtInr * parseFloat(percentages[name] || 0) / 100 };
      if (splitType === 'share') return { name, user_id: u?.id, shares: parseFloat(shareUnits[name] || 1), amount: amtInr * parseFloat(shareUnits[name] || 1) / selectedMembers.length };
      return { name };
    });
  };

  const save = async () => {
    if (!desc || !amount || !paidBy || !date) return setErr('Fill all required fields');
    const paid_by_user = users.find(u => u.name === paidBy);
    const body = { group_id: groupId, description: desc, amount: parseFloat(amount), currency, exchange_rate: parseFloat(rate), paid_by_user_id: paid_by_user?.id, paid_by_name: paidBy, expense_date: date, split_type: splitType, splits: buildSplits(), notes };
    if (expense?.id) await api('/expenses/' + expense.id, { method: 'PUT', body });
    else await api('/expenses', { method: 'POST', body });
    onSave();
  };

  return (
    <div className="form-card">
      <h3>{expense ? 'Edit Expense' : 'Add Expense'}</h3>
      <div className="form-grid">
        <div className="field full"><label>Description*</label><input value={desc} onChange={e => setDesc(e.target.value)} /></div>
        <div className="field"><label>Amount*</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div className="field"><label>Currency</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)}>
            <option>INR</option><option>USD</option>
          </select>
        </div>
        {currency !== 'INR' && <div className="field"><label>Rate (1 {currency} = ? INR)</label><input type="number" value={rate} onChange={e => setRate(e.target.value)} /></div>}
        <div className="field"><label>Paid by*</label>
          <select value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            <option value="">Select…</option>
            {users.map(u => <option key={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Date*</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="field"><label>Split type</label>
          <select value={splitType} onChange={e => setSplitType(e.target.value)}>
            <option value="equal">Equal</option>
            <option value="unequal">Unequal</option>
            <option value="percentage">Percentage</option>
            <option value="share">Share units</option>
          </select>
        </div>
        <div className="field full"><label>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>

      <div className="members-section">
        <label>Split with:</label>
        <div className="member-chips">
          {users.map(u => (
            <button key={u.id} className={`chip ${selectedMembers.includes(u.name) ? 'active' : ''}`} onClick={() => toggleMember(u.name)}>{u.name}</button>
          ))}
        </div>
        {splitType === 'unequal' && selectedMembers.map(name => (
          <div key={name} className="split-input"><label>{name}</label><input type="number" placeholder="Amount" onChange={e => setUnequalAmts(p => ({ ...p, [name]: e.target.value }))} /></div>
        ))}
        {splitType === 'percentage' && selectedMembers.map(name => (
          <div key={name} className="split-input"><label>{name}</label><input type="number" placeholder="%" onChange={e => setPercentages(p => ({ ...p, [name]: e.target.value }))} /><span>%</span></div>
        ))}
        {splitType === 'share' && selectedMembers.map(name => (
          <div key={name} className="split-input"><label>{name}</label><input type="number" placeholder="Shares" defaultValue={1} onChange={e => setShareUnits(p => ({ ...p, [name]: e.target.value }))} /></div>
        ))}
      </div>

      {err && <div className="err">{err}</div>}
      <div className="form-actions">
        <button className="btn-primary" onClick={save}>Save</button>
        <button className="btn-sec" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── IMPORT ───────────────────────────────────────────────────────────────────
function Import({ groupId }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState([]);

  useEffect(() => {
    api('/import/reports').then(setReports).catch(() => {});
  }, [result]);

  const doImport = async () => {
    if (!file) return;
    setLoading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('group_id', groupId);
    const token = localStorage.getItem('token');
    const r = await fetch('/api/import/import', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    const data = await r.json();
    setResult(data);
    setLoading(false);
  };

  const anomalyColors = { EXACT_DUPLICATE: '#e74c3c', CONFLICTING_DUPLICATE: '#e67e22', SETTLEMENT_AS_EXPENSE: '#9b59b6', MISSING_PAID_BY: '#e67e22', AMOUNT_WITH_COMMA: '#3498db', ZERO_AMOUNT: '#95a5a6', NEGATIVE_AMOUNT: '#2ecc71', MISSING_CURRENCY: '#e67e22', NONSTANDARD_DATE: '#3498db', AMBIGUOUS_DATE: '#e67e22', LEFT_MEMBER_IN_SPLIT: '#e74c3c', NOT_YET_MEMBER_IN_SPLIT: '#e74c3c', EXTERNAL_PERSON_IN_SPLIT: '#9b59b6', PERCENTAGE_NOT_100: '#e67e22', SPLIT_TYPE_DETAIL_MISMATCH: '#e67e22', UNEQUAL_SUM_MISMATCH: '#e67e22', MISSING_SPLIT_TYPE: '#95a5a6' };

  return (
    <div className="page">
      <h2>Import CSV</h2>
      <div className="import-box">
        <p>Upload <code>expenses_export.csv</code>. The importer will detect all data anomalies and report them.</p>
        <input type="file" accept=".csv" onChange={e => setFile(e.target.files[0])} />
        <button className="btn-primary" onClick={doImport} disabled={!file || loading}>
          {loading ? 'Importing…' : 'Import'}
        </button>
      </div>

      {result && (
        <div className="import-result">
          <div className="import-stats">
            <div className="stat"><span>{result.total_rows}</span>Total rows</div>
            <div className="stat green"><span>{result.imported}</span>Imported</div>
            <div className="stat red"><span>{result.skipped}</span>Skipped</div>
            <div className="stat orange"><span>{result.anomalies?.length}</span>Anomalies</div>
          </div>

          {result.pending_approval?.length > 0 && (
            <div className="approval-section">
              <h3>⚠️ Flagged for Review (Meera's request)</h3>
              <p>These rows were automatically handled but require manual review before deletion is confirmed:</p>
              {result.pending_approval.map((p, i) => (
                <div key={i} className="approval-item">Row {p.row}: {p.detail}</div>
              ))}
            </div>
          )}

          <h3>Import Report — Anomaly Log</h3>
          <div className="anomaly-list">
            {result.anomalies?.map((a, i) => (
              <div key={i} className="anomaly-row" style={{ borderLeftColor: anomalyColors[a.type] || '#999' }}>
                <div className="anomaly-header">
                  <span className="anomaly-badge" style={{ background: anomalyColors[a.type] || '#999' }}>{a.type}</span>
                  <span className="anomaly-row-num">Row {a.row}</span>
                  {a.requires_approval && <span className="anomaly-badge" style={{ background: '#e67e22' }}>NEEDS REVIEW</span>}
                </div>
                <div className="anomaly-desc"><strong>{a.description}</strong></div>
                <div className="anomaly-action">→ {a.action}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {reports.length > 0 && !result && (
        <div>
          <h3>Previous imports</h3>
          {reports.map(r => (
            <div key={r.id} className="report-row">
              <span>{r.imported_at}</span>
              <span>{r.imported_rows} imported, {r.skipped_rows} skipped</span>
              <span>{JSON.parse(r.anomalies || '[]').length} anomalies</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SETTLEMENTS ─────────────────────────────────────────────────────────────
function Settlements({ groupId, users }) {
  const [settlements, setSettlements] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  const load = useCallback(() => api('/expenses/settlements/list?group_id=' + groupId).then(setSettlements), [groupId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const fromU = users.find(u => u.name === from);
    const toU = users.find(u => u.name === to);
    await api('/expenses/settlements', { method: 'POST', body: { group_id: groupId, from_user_id: fromU?.id, to_user_id: toU?.id, amount: parseFloat(amount), settlement_date: date, notes } });
    setShowForm(false);
    load();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settlements</h2>
        <button className="btn-primary" onClick={() => setShowForm(true)}>+ Record Payment</button>
      </div>
      {showForm && (
        <div className="form-card">
          <h3>Record Settlement</h3>
          <div className="form-grid">
            <div className="field"><label>From (payer)</label>
              <select value={from} onChange={e => setFrom(e.target.value)}>
                <option value="">Select…</option>
                {users.map(u => <option key={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="field"><label>To (receiver)</label>
              <select value={to} onChange={e => setTo(e.target.value)}>
                <option value="">Select…</option>
                {users.map(u => <option key={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Amount (₹)</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="field full"><label>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={save}>Save</button>
            <button className="btn-sec" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="expense-list">
        {settlements.map(s => (
          <div key={s.id} className="expense-card">
            <div className="exp-date">{s.settlement_date}</div>
            <div className="exp-desc settlement-label">💸 Settlement</div>
            <div className="exp-meta"><strong>{s.from_name}</strong> paid <strong>{s.to_name}</strong></div>
            <div className="exp-amount">₹{s.amount}</div>
          </div>
        ))}
        {settlements.length === 0 && <div className="empty">No settlements recorded yet.</div>}
      </div>
    </div>
  );
}

// ─── MEMBERS ─────────────────────────────────────────────────────────────────
function Members({ groupId, users }) {
  const [group, setGroup] = useState(null);
  const load = useCallback(() => api('/groups/' + groupId).then(setGroup), [groupId]);
  useEffect(() => { load(); }, [load]);

  const addMember = async () => {
    const name = prompt('User name?');
    const date = prompt('Join date (YYYY-MM-DD)?', new Date().toISOString().split('T')[0]);
    const u = users.find(u => u.name.toLowerCase() === name?.toLowerCase());
    if (!u || !date) return alert('User not found or invalid date');
    await api('/groups/' + groupId + '/members', { method: 'POST', body: { user_id: u.id, joined_at: date } });
    load();
  };

  const removeMember = async (uid, name) => {
    const date = prompt(`When did ${name} leave? (YYYY-MM-DD)`, new Date().toISOString().split('T')[0]);
    if (!date) return;
    await api('/groups/' + groupId + '/members/' + uid, { method: 'PATCH', body: { left_at: date } });
    load();
  };

  if (!group) return <div className="loading">Loading…</div>;

  const current = group.members?.filter(m => !m.left_at) || [];
  const past = group.members?.filter(m => m.left_at) || [];

  return (
    <div className="page">
      <div className="page-header"><h2>Members — {group.name}</h2><button className="btn-primary" onClick={addMember}>+ Add Member</button></div>
      <h3>Current members</h3>
      <div className="member-list">
        {current.map(m => (
          <div key={m.id} className="member-card">
            <div className="member-avatar">{m.name[0]}</div>
            <div>
              <div className="member-name">{m.name}</div>
              <div className="member-meta">Joined {m.joined_at}</div>
            </div>
            <button className="btn-sm danger" onClick={() => removeMember(m.user_id, m.name)}>Remove</button>
          </div>
        ))}
      </div>
      {past.length > 0 && <>
        <h3>Past members</h3>
        <div className="member-list">
          {past.map(m => (
            <div key={m.id} className="member-card past">
              <div className="member-avatar dim">{m.name[0]}</div>
              <div>
                <div className="member-name">{m.name}</div>
                <div className="member-meta">Joined {m.joined_at} · Left {m.left_at}</div>
              </div>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('Dashboard');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) setUser({ id: payload.id, name: payload.name });
        else localStorage.removeItem('token');
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (user) api('/auth/users').then(setUsers);
  }, [user]);

  if (!user) return <Login onLogin={u => { setUser(u); }} />;

  const GROUP_ID = 1;
  const logout = () => { localStorage.removeItem('token'); setUser(null); };

  return (
    <div className="app">
      <Nav user={user} page={page} setPage={setPage} onLogout={logout} />
      <div className="content">
        {page === 'Dashboard' && <Dashboard groupId={GROUP_ID} />}
        {page === 'Expenses' && <Expenses groupId={GROUP_ID} users={users} />}
        {page === 'Import' && <Import groupId={GROUP_ID} />}
        {page === 'Settlements' && <Settlements groupId={GROUP_ID} users={users} />}
        {page === 'Members' && <Members groupId={GROUP_ID} users={users} />}
      </div>
    </div>
  );
}
