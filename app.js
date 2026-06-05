// ── Storage (localStorage + Gist sync) ──────────────────────────────────────
const mem = {};
const LS_PREFIX = 'polaris_';

function lsGet(k) {
  try { const v = localStorage.getItem(LS_PREFIX + k); return v !== null ? JSON.parse(v) : undefined; }
  catch(e) { return undefined; }
}
function lsSet(k, v) {
  try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch(e) {}
}
async function sget(k, d) {
  try { if (window.storage) { const r = await window.storage.get(k); if (r) return JSON.parse(r.value); } } catch(e) {}
  const lv = lsGet(k); if (lv !== undefined) return lv;
  return (k in mem) ? mem[k] : d;
}
async function sset(k, v) {
  mem[k] = v;
  lsSet(k, v);
  try { if (window.storage) await window.storage.set(k, JSON.stringify(v)); } catch(e) {}
  scheduleGistSave();
}

// ── Gist sync ────────────────────────────────────────────────────────────────
const GIST_ID = 'd58f9448582e6aeef638dfd28b2482a7';
const GIST_FILE = 'polaris-data.json';
const GIST_KEYS = ['tasks', 'vocab', 'ideas', 'settings'];
let gistTimer = null;

function getToken() { return localStorage.getItem('polaris_gh_token') || ''; }
function setSyncStatus(state, msg) {
  const el = document.getElementById('syncStatus'); if (!el) return;
  const cfg = { idle: { c: '#5b6886', t: '●' }, saving: { c: 'var(--amber)', t: '↑ saving…' }, ok: { c: 'var(--green)', t: '✓ synced' }, err: { c: 'var(--red)', t: '⚠ sync error' } };
  const s = cfg[state] || cfg.idle; el.style.color = s.c; el.title = msg || ''; el.textContent = s.t;
}
async function gistLoad() {
  const token = getToken(); if (!token) return false;
  setSyncStatus('saving', 'Loading from cloud…');
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
    if (!res.ok) { setSyncStatus('err', 'Load failed: ' + res.status); return false; }
    const data = await res.json();
    const file = data.files[GIST_FILE];
    if (!file || file.content === '{}') { setSyncStatus('ok', 'No cloud data yet'); return false; }
    const parsed = JSON.parse(file.content);
    GIST_KEYS.forEach(k => { if (parsed[k] !== undefined) lsSet(k, parsed[k]); });
    setSyncStatus('ok', 'Loaded from cloud'); return true;
  } catch(e) { setSyncStatus('err', 'Network error'); return false; }
}
async function gistSave() {
  const token = getToken();
  if (!token) { setSyncStatus('idle', 'Token not set — data saved locally only'); return; }
  setSyncStatus('saving', 'Saving to cloud…');
  try {
    const payload = {};
    GIST_KEYS.forEach(k => { const v = lsGet(k); if (v !== undefined) payload[k] = v; });
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, { method: 'PATCH', headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' }, body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(payload) } } }) });
    if (!res.ok) { setSyncStatus('err', 'Save failed: ' + res.status); return; }
    setSyncStatus('ok', 'Saved to cloud ✓');
  } catch(e) { setSyncStatus('err', 'Network error — saved locally'); }
}
function scheduleGistSave() { clearTimeout(gistTimer); gistTimer = setTimeout(gistSave, 3000); }

// ── State ────────────────────────────────────────────────────────────────────
let tasks = [], vocab = [], ideas = [], settings = {};
let current = 'today', filter = 'all', boardFilter = 'all', metricPeriod = 'total';
let search = '', sortCol = 'createdAt', sortDir = -1, calY, calM, calSel = null;
let addRowOpen = false;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const PRIOS = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
const STATUSES = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
const STAT_COLOR = { todo: 'var(--txt-faint)', in_progress: 'var(--blue)', blocked: 'var(--red)', done: 'var(--green)' };
const TITLES = { today: 'Today', board: 'Board', calendar: 'Calendar', table: 'All Activities', metrics: 'Metrics', products: 'Products', vocab: 'Vocabulary', ideas: 'Backlog & Ideas', settings: 'Settings' };
const DEFAULTS = { name: 'Rodrigo', types: ['Project document', 'Mechanical test', 'System registration', 'Research', 'Supplier dealing', 'Meeting', 'Production support'], sectors: ['Engineering', 'Production', 'Maintenance', 'Planning', 'Quality', 'Personal'], products: ['P-204 Pump', 'Conveyor C-12', 'Line 3'], sources: ['Project Sprint', 'Coordinator', 'Director', 'Production', 'Self'], projects: [], template: ['Product specification', 'Technical drawing', 'Test report', 'System registration'], calendar: {}, focusDate: '', focusIds: [], collapsed: false };

const DAY = 86400000;
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const today = () => startOfDay(new Date());
const ymd = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const todayStr = () => ymd(new Date());
const parseDate = s => { if (!s) return null; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? null : d; };
const fmtDate = s => { const d = parseDate(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'; };
const relDays = s => { const d = parseDate(s); return d ? Math.round((startOfDay(d) - today()) / DAY) : null; };
function weekRange(o = 0) { const t = today(); const dow = t.getDay(); const mon = new Date(t.getTime() - ((dow + 6) % 7) * DAY + o * 7 * DAY); return [mon, new Date(mon.getTime() + 7 * DAY)]; }
const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uniq = a => [...new Set(a)];
const replyDue = t => Array.isArray(t.contacts) && t.contacts.some(c => c.ball === 'me');
const replyBadge = t => replyDue(t) ? '<span class="reply-badge">↩︎ reply due</span>' : '';
const sprintBadge = t => (t.sector === 'Engineering Projects' && t.sprint) ? `<span class="sprint-ic" title="Sprint activity"><svg width="12" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>` : '';
const directiveBadge = t => (t.sector === 'Engineering Coordination' || t.sector === 'Industrial Management') ? `<span class="directive-ic" title="${esc(t.sector)}">⚠</span>` : '';
const typeOptions = () => uniq([...(settings.types || []), ...tasks.map(t => t.type).filter(Boolean)]);
const sectorOptions = () => uniq([...(settings.sectors || []), ...tasks.map(t => t.sector).filter(Boolean)]);
const productOptions = () => uniq([...(settings.products || []), ...tasks.map(t => t.product).filter(Boolean)]);
const sourceOptions = () => uniq([...(settings.sources || []), ...tasks.map(t => t.source).filter(Boolean)]);
const projectOptions = () => uniq([...(settings.projects || []), ...tasks.map(t => t.project).filter(Boolean)]);

// ── Filters ──────────────────────────────────────────────────────────────────
function matchesFilter(t, f) {
  if (f === 'all') return true;
  if (f === 'todo') return t.status === 'todo';
  if (f === 'in_progress') return t.status === 'in_progress';
  if (f === 'blocked') return t.status === 'blocked';
  if (f === 'done') return t.status === 'done';
  if (f === 'reply') return replyDue(t);
  if (t.status === 'done') return false;
  const d = parseDate(t.deadline), rd = relDays(t.deadline);
  if (rd === null) return false;
  if (f === 'overdue') return rd < 0;
  if (f === 'today') return rd === 0;
  if (f === 'tomorrow') return rd === 1;
  if (f === 'week') { const [a, b] = weekRange(0); return d >= a && d < b; }
  if (f === 'next') { const [a, b] = weekRange(1); return d >= a && d < b; }
  if (f === 'future') { const [, b] = weekRange(1); return d >= b; }
  return true;
}
function boardMatch(t, f) {
  if (f === 'all') return true;
  if (f === 'reply') return replyDue(t);
  const d = parseDate(t.deadline), rd = relDays(t.deadline);
  if (rd === null) return false;
  if (f === 'overdue') return rd < 0 && t.status !== 'done';
  if (f === 'today') return rd === 0;
  if (f === 'tomorrow') return rd === 1;
  if (f === 'week') { const [a, b] = weekRange(0); return d >= a && d < b; }
  if (f === 'next') { const [a, b] = weekRange(1); return d >= a && d < b; }
  return true;
}
const matchSearch = t => !search || (t.title + ' ' + t.description + ' ' + t.requester + ' ' + t.product + ' ' + t.type + ' ' + t.sector + ' ' + t.source + ' ' + t.project).toLowerCase().includes(search.toLowerCase());
const countFor = f => tasks.filter(t => matchesFilter(t, f) && matchSearch(t)).length;
const FILTER_GROUPS = [
  [{ k: 'all', label: 'All' }],
  [{ k: 'todo', label: 'To do' }, { k: 'in_progress', label: 'In progress' }, { k: 'blocked', label: 'Blocked' }, { k: 'done', label: 'Done' }, { k: 'reply', label: 'Reply due' }],
  [{ k: 'overdue', label: 'Overdue', danger: 1 }, { k: 'today', label: 'Today' }, { k: 'week', label: 'This week' }, { k: 'next', label: 'Next week' }]
];
const BOARD_FILTERS = [{ k: 'all', label: 'All' }, { k: 'overdue', label: 'Overdue', danger: 1 }, { k: 'today', label: 'Today' }, { k: 'tomorrow', label: 'Tomorrow' }, { k: 'week', label: 'This week' }, { k: 'next', label: 'Next week' }, { k: 'reply', label: 'Reply due' }];

// ── Focus (Today pins) ────────────────────────────────────────────────────────
function ensureFocus() { if (settings.focusDate !== todayStr()) { settings.focusDate = todayStr(); settings.focusIds = []; } }
function toggleFocus(id) {
  ensureFocus();
  const i = settings.focusIds.indexOf(id);
  if (i >= 0) settings.focusIds.splice(i, 1);
  else { if (settings.focusIds.length >= 3) { toast('Pick up to 3 for today'); return; } settings.focusIds.push(id); }
  sset('settings', settings); renderToday();
}

// ── TODAY ─────────────────────────────────────────────────────────────────────
function frow(t) {
  const r = relDays(t.deadline);
  const due = (() => {
    if (t.status === 'done') return '<span class="due" style="background:var(--green-soft);color:var(--green)">✓ done</span>';
    if (r === null) return '';
    if (r < 0) return `<span class="due over">${-r}d late</span>`;
    if (r === 0) return '<span class="due soon">today</span>';
    if (r === 1) return '<span class="due soon">tomorrow</span>';
    return `<span class="due">${fmtDate(t.deadline)}</span>`;
  })();
  const starred = (settings.focusIds || []).includes(t.id);
  return `<div class="frow ${t.status === 'done' ? 'done' : ''}" data-open="${t.id}">
    <div class="chk" data-toggle-done="${t.id}">✓</div>
    <div class="prio-bar prio-${t.priority}" style="height:30px"></div>
    <div class="ftitle">${esc(t.title) || '<i style="color:var(--txt-faint)">untitled</i>'}
      <div class="fmeta">${t.type ? `<span class="tag type">${esc(t.type)}</span>` : ''}${t.product ? `<span class="tag">${esc(t.product)}</span>` : ''}${t.sector ? `<span class="tag sec-tag">${esc(t.sector)}</span>` : ''}${t.priority ? `<span class="prio-tag prio-${t.priority}">${PRIOS[t.priority]}</span>` : ''}${sprintBadge(t)}${directiveBadge(t)}${replyBadge(t)}${due}</div>
    </div>
    <button class="star ${starred ? 'on' : ''}" data-star="${t.id}" title="Set as today's focus">${starred ? '★' : '☆'}</button>
  </div>`;
}
const block = (cls, icon, title, n, items, emptyTxt) => `<div class="focus-block ${cls}"><div class="fb-head">${icon}<h3>${title}</h3><span class="ct">${n}</span></div>${items.length ? items.map(frow).join('') : `<div style="color:var(--txt-faint);font-size:13.5px;padding:2px 2px 6px">${emptyTxt}</div>`}</div>`;

function renderToday() {
  ensureFocus();
  const isDoneToday = t => t.completedAt && startOfDay(t.completedAt).getTime() === today().getTime();
  const doneToday = tasks.filter(isDoneToday);
  const overdueOpen = tasks.filter(t => t.status !== 'done' && relDays(t.deadline) < 0);
  const todayOpen = tasks.filter(t => t.status !== 'done' && relDays(t.deadline) === 0);
  const openFirst = arr => arr.slice().sort((a, b) => { const da = a.status === 'done' ? 1 : 0, db = b.status === 'done' ? 1 : 0; if (da !== db) return da - db; return ((relDays(a.deadline)) ?? 0) - ((relDays(b.deadline)) ?? 0); });
  const over = openFirst([...overdueOpen, ...doneToday.filter(t => relDays(t.deadline) < 0)]);
  const due = openFirst([...todayOpen, ...doneToday.filter(t => relDays(t.deadline) === 0)]);
  const otherDone = doneToday.filter(t => { const r = relDays(t.deadline); return r === null || r > 0; });
  const next = tasks.filter(t => t.status !== 'done' && relDays(t.deadline) === 1);
  const reply = tasks.filter(t => t.status !== 'done' && replyDue(t));
  const totalDay = overdueOpen.length + todayOpen.length + doneToday.length;
  const dayPct = totalDay ? Math.round(doneToday.length / totalDay * 100) : 0;
  const h = new Date().getHours();
  const greet = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + (settings.name ? ', ' + esc(settings.name) : '');
  const dstr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const inProg = tasks.filter(t => t.status === 'in_progress').length;
  const m = todayStr().slice(0, 7);
  const doneMonth = tasks.filter(t => t.completedAt && t.completedAt.slice(0, 7) === m).length;
  const stat = (k, v, c) => `<div class="stat" style="--accent:${c}"><div class="k">${k}</div><div class="v">${v}</div></div>`;

  let html = `<div class="today-hero"><div class="greet">${greet} 👋</div><div class="datestr">${dstr}</div><div class="daybar-wrap"><div class="daybar-top"><span>Today's progress</span><span><b>${doneToday.length}</b> of ${totalDay} done</span></div><div class="daybar"><div class="fill" style="width:${dayPct}%"></div></div></div></div>`;
  const focusTasks = (settings.focusIds || []).map(id => tasks.find(t => t.id === id)).filter(Boolean);
  html += `<div class="focus-card"><div class="fc-h">⭐ Today's focus</div>`;
  if (focusTasks.length) html += focusTasks.map((t, i) => `<div class="focus-item ${t.status === 'done' ? 'done' : ''}" data-open="${t.id}"><span class="num">${i + 1}</span><span class="ft">${esc(t.title)}</span>${t.product ? `<span class="tag">${esc(t.product)}</span>` : ''}<span class="due ${relDays(t.deadline) < 0 && t.status !== 'done' ? 'over' : ''}">${t.status === 'done' ? '✓' : (relDays(t.deadline) === 0 ? 'today' : fmtDate(t.deadline))}</span></div>`).join('');
  else html += `<div class="hint">What are the 1–3 things that matter most today? Tap the ☆ on any task below to pin them here.</div>`;
  html += `</div>`;
  html += `<div class="stats">${stat('Overdue', overdueOpen.length, 'var(--red)')}${stat('Due today', todayOpen.length, 'var(--amber)')}${stat('In progress', inProg, 'var(--blue)')}${stat('Done this month', doneMonth, 'var(--green)')}</div>`;
  if (reply.length) html += block('fb-reply', '📨', 'Awaiting your reply', reply.length, reply, '');
  const nothingOpen = !overdueOpen.length && !todayOpen.length;
  if (nothingOpen) html += `<div class="celebrate"><div class="big">${doneToday.length ? 'Day cleared 🎉' : 'All clear for today'}</div><div style="color:var(--txt-dim);margin-top:6px">${doneToday.length ? `You cleared everything scheduled for today — ${doneToday.length} done.` : 'Nothing overdue and nothing due today. Pull something forward from the board, or enjoy the win.'}</div></div>`;
  if (over.length) html += block('fb-over', '⚠️', 'Overdue — handle first', overdueOpen.length, over, '');
  if (due.length || todayOpen.length) html += block('fb-today', '🎯', 'Due today', todayOpen.length, due, 'Nothing scheduled for today.');
  if (otherDone.length) html += block('fb-today', '✅', 'Also done today', otherDone.length, otherDone, '');
  if (next.length) html += block('fb-next', '⏭️', 'Coming up tomorrow', next.length, next, '');
  document.getElementById('view-today').innerHTML = html;
}

// ── BOARD ─────────────────────────────────────────────────────────────────────
let draggedId = null, downXY = null;
function renderBoardFilters() { document.getElementById('boardFilters').innerHTML = BOARD_FILTERS.map(f => `<button class="chip ${boardFilter === f.k ? 'on' : ''} ${f.danger ? 'danger' : ''}" data-bf="${f.k}">${f.label}</button>`).join(''); }
function renderBoard() {
  renderBoardFilters();
  const cols = [['todo', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];
  const card = t => `<div class="kcard pl-${t.priority}" draggable="true" data-card="${t.id}"><div class="kt">${esc(t.title) || 'untitled'}</div><div class="km">${t.deadline ? `<span class="due ${t.status !== 'done' && relDays(t.deadline) < 0 ? 'over' : (t.status !== 'done' && relDays(t.deadline) <= 2 ? 'soon' : '')}">${fmtDate(t.deadline)}</span>` : ''}${t.type ? `<span class="tag type">${esc(t.type)}</span>` : ''}${t.product ? `<span class="tag">${esc(t.product)}</span>` : ''}${t.sector ? `<span class="tag sec-tag">${esc(t.sector)}</span>` : ''}${t.priority ? `<span class="prio-tag prio-${t.priority}">${PRIOS[t.priority]}</span>` : ''}${sprintBadge(t)}${directiveBadge(t)}${replyBadge(t)}</div>${t.progress ? `<div class="kmini"><i style="width:${t.progress}%"></i></div>` : ''}</div>`;
  document.getElementById('board').innerHTML = cols.map(([k, label]) => {
    const items = tasks.filter(t => t.status === k && boardMatch(t, boardFilter) && matchSearch(t)).sort((a, b) => { const o = { urgent: 0, high: 1, medium: 2, low: 3 }; const ra = relDays(a.deadline), rb = relDays(b.deadline); if (ra !== rb) { if (ra === null) return 1; if (rb === null) return -1; return ra - rb; } return o[a.priority] - o[b.priority]; });
    const warn = k === 'in_progress' && items.length > 5 ? 'warn' : '';
    return `<div class="kcol" data-col="${k}"><div class="kcol-head"><div class="ktitle"><span class="kdot" style="background:${STAT_COLOR[k]}"></span>${label} <span class="kn ${warn}">${items.length}${warn ? ' ⚠' : ''}</span></div><button class="kadd" data-kadd="${k}">＋</button></div><div class="klist">${items.length ? items.map(card).join('') : '<div class="kempty">Drop tasks here</div>'}</div></div>`;
  }).join('');
  bindDnD();
}
function bindDnD() {
  document.querySelectorAll('.kcard').forEach(c => {
    c.addEventListener('dragstart', e => { draggedId = c.dataset.card; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    c.addEventListener('dragend', () => { c.classList.remove('dragging'); draggedId = null; });
    c.addEventListener('mousedown', e => downXY = [e.clientX, e.clientY]);
    c.addEventListener('click', e => { if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) < 6) openModal(getTask(c.dataset.card)); });
  });
  document.querySelectorAll('.kcol').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('drag-over'); if (draggedId) inlineEdit(draggedId, 'status', col.dataset.col).then(() => renderBoard()); });
  });
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
function renderFilters() {
  const isDeadlineSort = sortCol === 'deadline' && sortDir === 1;
  const isNewestSort = sortCol === 'createdAt' && sortDir === -1;
  document.getElementById('filters').innerHTML =
    FILTER_GROUPS.map(g => g.map(f => `<button class="chip ${filter === f.k ? 'on' : ''} ${f.danger ? 'danger' : ''}" data-f="${f.k}">${f.label} <span class="n">${countFor(f.k)}</span></button>`).join('')).join('<span class="fdiv"></span>')
    + `<span class="fdiv"></span><button class="chip ${isNewestSort ? 'on' : ''}" data-sq="createdAt:-1">🆕 Newest</button><button class="chip ${isDeadlineSort ? 'on' : ''}" data-sq="deadline:1">📅 Deadline ↑</button>`;
}
const COLS = [{ k: 'num', l: '#' }, { k: 'title', l: 'Task' }, { k: 'type', l: 'Type' }, { k: 'product', l: 'Product' }, { k: 'sector', l: 'Sector' }, { k: 'deadline', l: 'Deadline' }, { k: 'daysLeft', l: 'Days left' }, { k: 'completedAt', l: 'Completed' }, { k: 'priority', l: 'Priority' }, { k: 'progress', l: 'Progress' }, { k: 'status', l: 'Status' }, { k: 'createdAt', l: 'Created' }];
const NUM_COLS = COLS.length;
const nextNum = () => Math.max(0, ...tasks.map(t => t.num || 0)) + 1;

function addRowHTML() {
  if (!addRowOpen) {
    return `<tr class="addrow-trigger"><td colspan="${NUM_COLS}"><button class="ar-trigger" id="ar-open">＋ New activity</button></td></tr>`;
  }
  return `<tr class="addrow">
    <td><div class="ar-actions"><button class="ar-add" id="ar-add" title="Save (Enter)">✓</button><button class="ar-cancel" id="ar-cancel" title="Cancel">✕</button></div></td>
    <td><input id="ar-title" placeholder="Activity title… (English)" autofocus></td>
    <td><select id="ar-type">${selOpts(typeOptions(), '')}</select></td>
    <td><select id="ar-prod">${selOpts(productOptions(), '')}</select></td>
    <td><select id="ar-sector">${selOpts(sectorOptions(), '')}</select></td>
    <td><input id="ar-due" type="date"></td>
    <td><span class="muted">—</span></td>
    <td><span class="muted">—</span></td>
    <td><select id="ar-prio">${Object.entries(PRIOS).map(([k, v]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><span class="muted">0%</span></td>
    <td><select id="ar-status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === 'todo' ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><span class="muted">today</span></td>
  </tr>`;
}
function commitAddRow() {
  const g = id => document.getElementById(id);
  const title = g('ar-title').value.trim();
  if (!title) { g('ar-title').focus(); toast('Type the activity title first'); return; }
  const obj = { id: uid(), num: nextNum(), title, description: '', requester: '', product: g('ar-prod').value.trim(), type: g('ar-type').value, sector: g('ar-sector').value, source: '', project: '', deadline: g('ar-due').value, priority: g('ar-prio').value, status: g('ar-status').value, progress: 0, hours: 0, blockers: '', notes: '', contacts: [], createdAt: new Date().toISOString(), completedAt: null };
  if (obj.status === 'done') { obj.completedAt = new Date().toISOString(); obj.progress = 100; }
  tasks.unshift(obj); addRowOpen = false; saveTasks();
  toast('Activity added ✓');
}
function renderTable() {
  let arr = tasks.filter(t => matchesFilter(t, filter) && matchSearch(t));
  const po = { urgent: 0, high: 1, medium: 2, low: 3 }, so = { todo: 0, in_progress: 1, blocked: 2, done: 3 };
  arr.sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (sortCol === 'priority') { va = po[a.priority]; vb = po[b.priority]; }
    if (sortCol === 'status') { va = so[a.status]; vb = so[b.status]; }
    if (sortCol === 'num') { va = a.num || 0; vb = b.num || 0; }
    if (sortCol === 'deadline') { va = parseDate(a.deadline) ? parseDate(a.deadline).getTime() : 9e15; vb = parseDate(b.deadline) ? parseDate(b.deadline).getTime() : 9e15; }
    if (sortCol === 'createdAt') { va = new Date(a.createdAt || 0).getTime(); vb = new Date(b.createdAt || 0).getTime(); }
    if (sortCol === 'daysLeft') { va = relDays(a.deadline) ?? 9999; vb = relDays(b.deadline) ?? 9999; }
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
  });
  const head = `<thead><tr>${COLS.map(c => `<th data-sort="${c.k}">${c.l}${sortCol === c.k ? ` <span class="ar">${sortDir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>`;
  let body;
  if (!arr.length) { body = `<tr><td colspan="${NUM_COLS}"><div class="empty"><div class="big">Nothing here</div><div>${tasks.length ? 'No tasks match this filter.' : 'Click "+ New activity" below to get started. ✍️'}</div></div></td></tr>`; }
  else body = arr.map(t => {
    const r = relDays(t.deadline); let dcls = '';
    if (t.status !== 'done') { if (r < 0) dcls = 'over'; else if (r !== null && r <= 2) dcls = 'soon'; }
    const daysCell = t.status === 'done'
      ? `<span class="badge b-done" style="font-size:10px">done</span>`
      : r === null ? `<span style="color:var(--txt-faint)">—</span>`
      : r < 0 ? `<span class="due over">${-r}d late</span>`
      : r === 0 ? `<span class="due soon">today</span>`
      : r === 1 ? `<span class="due soon">tomorrow</span>`
      : r <= 7 ? `<span class="due soon">${r}d</span>`
      : `<span style="color:var(--txt-dim);font-family:var(--mono);font-size:11.5px">${r}d</span>`;
    return `<tr data-open="${t.id}">
      <td class="idcell">${t.num || ''}</td>
      <td class="${t.status === 'done' ? 'done' : ''}"><div class="tt"><span class="prio-bar prio-${t.priority}" style="height:16px"></span>${esc(t.title) || 'untitled'} ${sprintBadge(t)}${directiveBadge(t)}${replyBadge(t)}</div></td>
      <td>${t.type ? `<span class="tag type">${esc(t.type)}</span>` : '<span style="color:var(--txt-faint)">—</span>'}</td>
      <td>${t.product ? `<span class="tag">${esc(t.product)}</span>` : '<span style="color:var(--txt-faint)">—</span>'}</td>
      <td>${t.sector ? `<span style="color:var(--txt-dim);font-size:12px">${esc(t.sector)}</span>` : '<span style="color:var(--txt-faint)">—</span>'}</td>
      <td><span class="due ${dcls}">${fmtDate(t.deadline)}</span></td>
      <td>${daysCell}</td>
      <td>${t.completedAt ? `<span style="color:var(--green);font-family:var(--mono);font-size:11.5px">${fmtDate(t.completedAt.slice(0,10))}</span>` : '<span style="color:var(--txt-faint)">—</span>'}</td>
      <td><span class="prio-tag prio-${t.priority}">${PRIOS[t.priority]}</span></td>
      <td><div data-iprog="${t.id}" class="prog-cell" title="Click to edit"><span class="minibar"><i style="width:${t.progress || 0}%"></i></span><span class="mono" style="font-size:11px;color:var(--txt-dim)">${t.progress || 0}%</span></div></td>
      <td><div data-istat="${t.id}" class="stat-cell" title="Click to change"><span class="badge b-${t.status}">${STATUSES[t.status]}</span><span style="color:var(--txt-faint);font-size:10px;margin-left:2px">▾</span></div></td>
      <td class="mono" style="color:var(--txt-faint);font-size:11px">${fmtDate((t.createdAt || '').slice(0, 10))}</td>
    </tr>`;
  }).join('');
  document.getElementById('tbl').innerHTML = head + `<tbody>${body}${addRowHTML()}</tbody>`;
  const aopen = document.getElementById('ar-open'); if (aopen) aopen.onclick = () => { addRowOpen = true; renderTable(); setTimeout(() => { const t = document.getElementById('ar-title'); if (t) t.focus(); }, 0); };
  const ab = document.getElementById('ar-add'); if (ab) ab.onclick = commitAddRow;
  const acan = document.getElementById('ar-cancel'); if (acan) acan.onclick = () => { addRowOpen = false; renderTable(); };
  const at = document.getElementById('ar-title'); if (at) at.addEventListener('keydown', e => { if (e.key === 'Enter') commitAddRow(); if (e.key === 'Escape') { addRowOpen = false; renderTable(); } });
}

// ── CUSTOM CONFIRM ────────────────────────────────────────────────────────────
function customConfirm(msg, { yes = 'Confirm', no = 'Cancel', danger = true } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'cscrim';
    wrap.innerHTML = `<div class="cbox"><div class="cmsg">${msg}</div><div class="cbtns"><button class="btn ghost csm cno">${no}</button><button class="btn ${danger ? 'danger' : 'primary'} csm cyes">${yes}</button></div></div>`;
    document.body.appendChild(wrap);
    const close = v => { wrap.remove(); resolve(v); };
    wrap.querySelector('.cyes').onclick = () => close(true);
    wrap.querySelector('.cno').onclick = () => close(false);
    wrap.onclick = e => { if (e.target === wrap) close(false); };
  });
}

// ── MUTATIONS ─────────────────────────────────────────────────────────────────
async function saveTasks() { await sset('tasks', tasks); refreshAll(); }
const getTask = id => tasks.find(t => t.id === id);
async function inlineEdit(id, field, value) {
  const t = getTask(id); if (!t) return;
  if (field === 'progress' || field === 'hours') value = parseFloat(value) || 0;
  t[field] = value;
  if (field === 'status') { if (value === 'done') { t.completedAt = new Date().toISOString(); t.progress = 100; } else { t.completedAt = null; if (value === 'in_progress' && !(t.progress > 0)) t.progress = 10; } }
  if (field === 'progress' && value >= 100 && t.status !== 'done') { t.status = 'done'; t.completedAt = new Date().toISOString(); }
  await sset('tasks', tasks); updateTabCounts();
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function selOpts(list, val) { return `<option value="">—</option>` + list.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join(''); }
function openModal(task) {
  const t = task || { id: null, title: '', description: '', requester: '', product: '', type: '', sector: '', source: '', project: '', deadline: '', priority: 'medium', progress: 0, status: 'todo', sprint: false, blockers: '', notes: '', hours: 0, contacts: [] };
  let clog = JSON.parse(JSON.stringify(t.contacts || []));
  let prioTouched = !!task;
  const BALL = { them: '⏳ Their court', me: '↩︎ Your reply', done: '✓ Resolved' };
  modalHost.innerHTML = `<div class="scrim" id="scrim"><div class="modal" onclick="event.stopPropagation()">
    <div class="mhead"><h3>${task ? 'Edit task' : 'New task'} <span style="font-family:var(--mono);font-size:12px;color:var(--teal)"> · write in English</span></h3><button class="xclose" id="mClose">✕</button></div>
    <div class="mbody">
      <div class="field"><label>Task title (English)</label><input id="f-title" value="${esc(t.title)}" placeholder="e.g. Review pump assembly drawing"></div>
      <div class="field"><label>Description</label><textarea id="f-desc" placeholder="Describe the activity in English…">${esc(t.description)}</textarea></div>
      <div id="tutorBox"></div><div style="display:flex;justify-content:flex-end"><button class="btn sm" id="checkEn">🌐 Check my English</button></div>
      <div class="row3">
        <div class="field"><label>Type</label><select id="f-type">${selOpts(typeOptions(), t.type)}</select></div>
        <div class="field"><label>Product</label><select id="f-prod">${selOpts(productOptions(), t.product)}</select></div>
        <div class="field"><label>Sector</label><select id="f-sector">${selOpts(sectorOptions(), t.sector)}</select></div>
      </div>
      <div class="field" style="max-width:260px"><label class="sprint-lbl"><input type="checkbox" id="f-sprint" ${t.sprint ? 'checked' : ''}><span class="sprint-ic" style="padding:3px 6px"><svg width="10" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></span> Sprint activity</label></div>
      <div class="row3">
        <div class="field"><label>Deadline</label><input id="f-due" type="date" value="${t.deadline || ''}"></div>
        <div class="field"><label>Priority</label><select id="f-prio">${Object.entries(PRIOS).map(([k, v]) => `<option value="${k}" ${t.priority === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Status</label><select id="f-status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="row2">
        <div class="field" style="max-width:200px"><label>Hours logged</label><input id="f-hours" type="number" min="0" step="0.5" value="${t.hours || 0}"></div>
        <div class="field" id="f-comp-wrap" style="${t.status === 'done' ? '' : 'display:none'}"><label>Completed on <span style="font-weight:400;color:var(--txt-faint)">(auto-filled, editable)</span></label><input id="f-comp" type="date" value="${(t.completedAt || '').slice(0, 10)}"></div>
      </div>
      <div class="field"><label>Progress — <span id="pv">${t.progress || 0}</span>%</label><div class="prog-row"><input id="f-prog" type="range" min="0" max="100" step="5" value="${t.progress || 0}"></div></div>
      <div class="field"><label>Blocked by (optional)</label><input id="f-block" value="${esc(t.blockers)}" placeholder="What's stopping it?"></div>
      <div class="field"><label>Notes &amp; drafts</label><textarea id="f-notes" placeholder="Scratch notes, links, sub-steps…">${esc(t.notes)}</textarea></div>
      <div class="subhead">📇 Supplier / contact log <span style="color:var(--txt-faint);text-transform:none;letter-spacing:0">— who you talked to & whose turn it is</span></div>
      <div id="contactList"></div>
      <div class="contact-add"><input id="c-name" placeholder="Supplier / person"><input id="c-note" placeholder="What was said / next step"><button class="btn sm" id="c-add">＋ Add</button></div>
    </div>
    <div class="mfoot">${task ? `<button class="btn danger sm" id="mDel">Delete</button>` : '<span></span>'}<div style="display:flex;gap:10px"><button class="btn ghost" id="mCancel">Cancel</button><button class="btn primary" id="mSave">${task ? 'Save' : 'Add task'}</button></div></div>
  </div></div>`;

  const close = () => modalHost.innerHTML = '';
  scrim.onclick = close; mClose.onclick = close; mCancel.onclick = close;
  document.getElementById('f-prog').oninput = e => document.getElementById('pv').textContent = e.target.value;
  document.getElementById('f-prio').addEventListener('change', () => prioTouched = true);
  document.getElementById('f-status').addEventListener('change', e => {
    const wrap = document.getElementById('f-comp-wrap'); if (!wrap) return;
    const isDone = e.target.value === 'done'; wrap.style.display = isDone ? '' : 'none';
    if (isDone && !document.getElementById('f-comp').value) document.getElementById('f-comp').value = new Date().toISOString().slice(0, 10);
  });
  const md = document.getElementById('mDel');
  if (md) md.onclick = async () => { if (await customConfirm('Delete this task?', { yes: 'Delete', no: 'Cancel', danger: true })) { tasks = tasks.filter(x => x.id !== t.id); await saveTasks(); close(); toast('Deleted'); } };

  function renderContacts() {
    const el = document.getElementById('contactList');
    el.innerHTML = clog.length ? clog.map((c, i) => `<div class="contact"><div class="ch"><span class="cn">${esc(c.name) || '—'}</span><span style="display:flex;gap:8px;align-items:center"><span class="ball ball-${c.ball}" data-cball="${i}">${BALL[c.ball]}</span><button class="cdel" data-cdel="${i}">✕</button></span></div>${c.note ? `<div class="cnote">${esc(c.note)}</div>` : ''}</div>`).join('') : '<div style="color:var(--txt-faint);font-size:13px;margin-bottom:6px">No contacts logged yet.</div>';
    el.querySelectorAll('[data-cball]').forEach(b => b.onclick = () => { const i = +b.dataset.cball; const seq = ['them', 'me', 'done']; clog[i].ball = seq[(seq.indexOf(clog[i].ball) + 1) % 3]; renderContacts(); });
    el.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => { clog.splice(+b.dataset.cdel, 1); renderContacts(); });
  }
  renderContacts();
  document.getElementById('c-add').onclick = () => { const n = document.getElementById('c-name'), o = document.getElementById('c-note'); if (!n.value.trim() && !o.value.trim()) { toast('Type the contact first'); return; } clog.push({ id: uid(), name: n.value.trim(), note: o.value.trim(), ball: 'me', at: new Date().toISOString() }); n.value = ''; o.value = ''; renderContacts(); };
  document.getElementById('checkEn').onclick = runTutor;

  async function runTutor() {
    const title = document.getElementById('f-title').value.trim(), desc = document.getElementById('f-desc').value.trim();
    const text = (title + (desc ? '. ' + desc : '')).trim();
    const box = document.getElementById('tutorBox');
    if (!text) { box.innerHTML = `<div class="tutor">Type your task in English first, then I'll check it.</div>`; return; }
    box.innerHTML = `<div class="tutor"><span class="spin"></span> Checking your English…</div>`;
    const sys = `You are an English tutor for a Brazilian mechanical/industrial engineer who writes task descriptions in English to practice. Check grammar, word choice and natural phrasing in a professional engineering register. Reply ONLY with strict JSON, no markdown:\n{"ok":boolean,"corrected":"corrected full text","notes":[{"issue":"short label","why":"one-sentence rule explanation in English"}]}\nIf already correct: ok=true, corrected=same text, notes=[].`;
    try {
      const out = await callClaude(sys, text);
      const data = JSON.parse(out.replace(/```json|```/g, '').trim());
      if (data.ok && (!data.notes || !data.notes.length)) box.innerHTML = `<div class="tutor good"><div class="ttl">✓ Looks good</div>Reads naturally. Nice work.</div>`;
      else {
        box.innerHTML = `<div class="tutor"><div class="ttl">🌐 Tutor feedback</div><div class="fix"><b>Suggested:</b> ${esc(data.corrected)} <button class="btn sm" style="margin-left:8px;padding:3px 9px" id="applyFix">Use this</button></div>${data.notes && data.notes.length ? '<ul>' + data.notes.map(n => `<li><b>${esc(n.issue)}:</b> ${esc(n.why)}</li>`).join('') + '</ul>' : ''}</div>`;
        const af = document.getElementById('applyFix'); if (af) af.onclick = () => { document.getElementById('f-title').value = data.corrected.split('. ')[0].replace(/\.$/, ''); if (desc) document.getElementById('f-desc').value = data.corrected; };
      }
    } catch(e) { box.innerHTML = `<div class="tutor">Couldn't reach the tutor right now — you can still save the task.</div>`; }
  }

  document.getElementById('mSave').onclick = async () => {
    const v = id => document.getElementById(id).value;
    const obj = { id: t.id || uid(), num: t.num || nextNum(), title: v('f-title').trim(), description: v('f-desc').trim(), requester: t.requester || '', product: v('f-prod').trim(), type: v('f-type'), sector: v('f-sector'), source: t.source || '', sprint: document.getElementById('f-sprint').checked, project: t.project || '', deadline: v('f-due'), priority: v('f-prio'), status: v('f-status'), progress: parseInt(v('f-prog')) || 0, hours: parseFloat(v('f-hours')) || 0, blockers: v('f-block').trim(), notes: v('f-notes').trim(), contacts: clog, createdAt: t.createdAt || new Date().toISOString(), completedAt: t.completedAt || null };
    const compField = document.getElementById('f-comp');
    if (obj.status === 'done') { const cd = compField && compField.value; obj.completedAt = cd ? new Date(cd + 'T12:00:00').toISOString() : (t.completedAt || new Date().toISOString()); obj.progress = 100; } else { obj.completedAt = null; }
    if (obj.progress >= 100 && obj.status !== 'done') { obj.status = 'done'; obj.completedAt = new Date().toISOString(); }
    if (!obj.title && !obj.description) { toast('Add at least a title'); return; }
    if (t.id) tasks = tasks.map(x => x.id === t.id ? obj : x); else tasks.unshift(obj);
    await saveTasks(); close(); toast(t.id ? 'Task updated ✓' : 'Task added ✓');
  };
}

// ── CLAUDE API ────────────────────────────────────────────────────────────────
async function callClaude(system, userText, maxTokens = 1000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages: [{ role: "user", content: userText }] }) });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

// ── VOCAB ─────────────────────────────────────────────────────────────────────
async function saveVocab() { await sset('vocab', vocab); }
function renderVocab() {
  if (!vocab.length) { document.getElementById('vocabGrid').innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">No vocabulary yet</div><div>Add tasks in English, then hit "Mine from tasks".</div></div>`; return; }
  document.getElementById('vocabGrid').innerHTML = vocab.map(v => `<div class="vcard"><div class="term">${esc(v.term)} <span class="vstat vs-${v.status}" data-cycle="${v.id}">${v.status}</span></div><div class="tr">${esc(v.translation)}</div>${v.example ? `<div class="ex">"${esc(v.example)}"</div>` : ''}</div>`).join('');
}
async function mineVocab() {
  const corpus = tasks.map(t => `${t.title}. ${t.description}`).join('\n').trim();
  if (!corpus) { toast('Add some tasks in English first'); return; }
  const existing = vocab.map(v => v.term.toLowerCase());
  const btn = document.getElementById('mineBtn'); btn.innerHTML = `<span class="spin"></span> Mining…`; btn.disabled = true;
  const sys = `You extract engineering / technical English vocabulary worth studying from task notes by a Brazilian engineer learning English. Pick useful words or short collocations; skip trivial words. Give a Brazilian Portuguese translation and a short natural English example. Reply ONLY strict JSON:\n{"terms":[{"term":"...","translation":"...","example":"..."}]}\nMax 12 terms. Exclude already-known: ${existing.join(', ') || '(none)'}.`;
  try {
    const out = await callClaude(sys, corpus, 1000);
    const data = JSON.parse(out.replace(/```json|```/g, '').trim());
    let added = 0;
    (data.terms || []).forEach(tm => { if (!tm.term) return; if (vocab.some(v => v.term.toLowerCase() === tm.term.toLowerCase())) return; vocab.unshift({ id: uid(), term: tm.term, translation: tm.translation || '', example: tm.example || '', status: 'new', addedAt: new Date().toISOString() }); added++; });
    await saveVocab(); refreshAll(); toast(added ? `${added} new term${added > 1 ? 's' : ''} added 📖` : 'No new terms found');
  } catch(e) { toast('Mining failed — try again'); }
  btn.innerHTML = `⛏️ Mine from tasks`; btn.disabled = false;
}
let fcOn = false, fcIdx = 0;
function toggleFlash() { fcOn = !fcOn; document.getElementById('flashArea').classList.toggle('hide', !fcOn); document.getElementById('flashBtn').classList.toggle('primary', fcOn); if (fcOn) { fcIdx = 0; renderFlash(); } }
function renderFlash() {
  const area = document.getElementById('flashArea');
  if (!vocab.length) { area.innerHTML = `<div class="empty">Mine some vocabulary first.</div>`; return; }
  const v = vocab[fcIdx % vocab.length];
  area.innerHTML = `<div class="fc-wrap"><div class="flashcard" id="fcard"><div class="fc-inner"><div class="fc-face fc-front"><div><div class="term">${esc(v.term)}</div><div class="hint">tap to reveal</div></div></div><div class="fc-face fc-back"><div><div class="tr">${esc(v.translation)}</div>${v.example ? `<div class="ex">"${esc(v.example)}"</div>` : ''}</div></div></div></div><div class="fc-count">${(fcIdx % vocab.length) + 1} / ${vocab.length}</div><div class="fc-controls"><button class="btn" id="fcLearn" style="color:var(--blue)">↻ Still learning</button><button class="btn" id="fcKnow" style="color:var(--green)">✓ I know this</button></div></div>`;
  const card = document.getElementById('fcard'); card.onclick = () => card.classList.toggle('flip');
  const next = async st => { v.status = st; await saveVocab(); fcIdx++; renderFlash(); renderVocab(); updateTabCounts(); };
  document.getElementById('fcLearn').onclick = () => next('learning');
  document.getElementById('fcKnow').onclick = () => next('known');
}

// ── METRICS ───────────────────────────────────────────────────────────────────
function periodRange(p) { const t = today(); if (p === 'today') return [t, new Date(t.getTime() + DAY)]; if (p === 'week') return weekRange(0); if (p === 'month') return [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 1)]; return null; }
function metricIn(t) { if (metricPeriod === 'total') return true; const [a, b] = periodRange(metricPeriod); const inR = d => { if (!d) return false; const s = typeof d === 'string' && !d.includes('T') ? d + 'T00:00:00' : d; const x = startOfDay(new Date(s)); return x >= a && x < b; }; return inR(t.deadline) || inR(t.completedAt); }
function groupCount(arr, field) { const m = {}; arr.forEach(t => { const v = (t[field] || '').trim() || '(none)'; m[v] = (m[v] || 0) + 1; }); return Object.entries(m).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n); }
function renderMetricChips() { const P = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['total', 'Total']]; document.getElementById('metricChips').innerHTML = P.map(([k, l]) => `<button class="chip ${metricPeriod === k ? 'on' : ''}" data-mp="${k}">${l}</button>`).join(''); }
function renderMetrics() {
  renderMetricChips();
  const mt = tasks.filter(metricIn);
  const total = mt.length, done = mt.filter(t => t.status === 'done').length, rate = total ? Math.round(done / total * 100) : 0;
  const hours = mt.reduce((s, t) => s + (+t.hours || 0), 0);
  const now = new Date();
  const curAbsM = now.getFullYear() * 12 + now.getMonth();
  const toKey = a => { const y = Math.floor(a / 12), m = a % 12; return y + '-' + String(m + 1).padStart(2, '0'); };
  const toLbl = (key, isCur, isNext) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }) + (isCur ? ' ●' : isNext ? ' →' : ''); };
  // Collect past months (up to 4) that actually have deadline or completion data
  const pastKeys = [];
  for (let i = 12; i >= 1 && pastKeys.length < 4; i--) {
    const k = toKey(curAbsM - i);
    if (tasks.some(t => (t.deadline || '').slice(0, 7) === k || (t.completedAt || '').slice(0, 7) === k)) pastKeys.push(k);
  }
  const curKey = toKey(curAbsM), nextKey = toKey(curAbsM + 1);
  const months = [...pastKeys, curKey, nextKey];
  const prog = months.map(m => tasks.filter(t => (t.deadline || '').slice(0, 7) === m).length);
  const compl = months.map(m => tasks.filter(t => (t.completedAt || '').slice(0, 7) === m).length);
  const maxv = Math.max(1, ...prog, ...compl);
  const labels = months.map(m => toLbl(m, m === curKey, m === nextKey));
  const byPrio = Object.keys(PRIOS).map(k => ({ k, label: PRIOS[k], n: mt.filter(t => t.priority === k).length }));
  const byStat = Object.keys(STATUSES).map(k => ({ k, label: STATUSES[k], n: mt.filter(t => t.status === k).length }));
  const byType = groupCount(mt, 'type'), byProd = groupCount(mt, 'product').slice(0, 10), bySector = groupCount(mt, 'sector');
  const prioColor = { urgent: 'var(--red)', high: 'var(--amber)', medium: 'var(--blue)', low: 'var(--txt-faint)' };
  const palette = ['var(--accent)', '#3d80e8', '#5b9bff', '#7ab5ff', 'var(--teal)', '#2aa8d4', '#6abcdf', '#8dcef0', 'var(--violet)', '#a8c8ff'];
  const distro = (arr, colorFn) => { const mx = Math.max(1, ...arr.map(a => a.n)); return `<div class="distro">${arr.map((a, i) => `<div class="row"><span class="lab" title="${esc(a.label)}">${esc(a.label)}</span><div class="track"><div class="fill" style="width:${a.n / mx * 100}%;background:${colorFn(a, i)}"></div></div><span class="num">${a.n}</span></div>`).join('')}</div>`; };
  const pl = metricPeriod === 'total' ? 'all time' : ({ today: 'today', week: 'this week', month: 'this month' }[metricPeriod]);
  document.getElementById('metricsBody').innerHTML = `
  <div class="metric-grid">
    <div class="mpanel"><h4>Completion rate · ${pl}</h4><div class="bigpct" style="color:var(--green)">${rate}%</div><div style="color:var(--txt-dim);margin-top:6px;font-size:13px">${done} of ${total} completed</div></div>
    <div class="mpanel"><h4>Open workload</h4><div class="bigpct">${mt.filter(t => t.status !== 'done').length}</div><div style="color:var(--txt-dim);margin-top:6px;font-size:13px">${mt.filter(t => t.status === 'blocked').length} blocked · ${mt.filter(t => relDays(t.deadline) < 0 && t.status !== 'done').length} overdue</div></div>
    <div class="mpanel"><h4>Hours logged · ${pl}</h4><div class="bigpct" style="color:var(--accent)">${hours}</div><div style="color:var(--txt-dim);margin-top:6px;font-size:13px">tracked across tasks</div></div>
    <div class="mpanel"><h4>Awaiting your reply</h4><div class="bigpct" style="color:var(--red)">${tasks.filter(t => t.status !== 'done' && replyDue(t)).length}</div><div style="color:var(--txt-dim);margin-top:6px;font-size:13px">supplier balls in your court</div></div>
  </div>
  <div class="metric-grid" style="grid-template-columns:1.4fr 1fr">
    <div class="mpanel"><h4>Deadlines vs. completed — by month</h4><div class="barchart">${labels.map((l, i) => `<div class="bc-col"><div class="bc-bars"><div class="bc-bar prog" style="height:${prog[i] / maxv * 120}px" title="${prog[i]} planned"></div><div class="bc-bar done" style="height:${compl[i] / maxv * 120}px" title="${compl[i]} completed"></div></div><div class="bc-lbl">${l}</div></div>`).join('')}</div><div class="legend"><span><i style="background:var(--blue)"></i>Planned</span><span><i style="background:var(--green)"></i>Completed</span></div></div>
    <div class="mpanel"><h4>By priority · ${pl}</h4>${distro(byPrio, a => prioColor[a.k])}<h4 style="margin-top:18px">By status</h4>${distro(byStat, a => STAT_COLOR[a.k])}</div>
  </div>
  <div class="metric-grid" style="grid-template-columns:1fr 1fr 1fr">
    <div class="mpanel"><h4>By type · ${pl}</h4>${byType.length ? distro(byType, (a, i) => palette[i % palette.length]) : '<div style="color:var(--txt-faint);font-size:13px">No data.</div>'}</div>
    <div class="mpanel"><h4>By product · ${pl}</h4>${byProd.length ? distro(byProd, (a, i) => palette[i % palette.length]) : '<div style="color:var(--txt-faint);font-size:13px">No data.</div>'}</div>
    <div class="mpanel"><h4>By sector · ${pl}</h4>${bySector.length ? distro(bySector, (a, i) => palette[i % palette.length]) : '<div style="color:var(--txt-faint);font-size:13px">No data.</div>'}</div>
  </div>`;
}

// ── PRODUCTS ──────────────────────────────────────────────────────────────────
function renderProducts() {
  const names = uniq([...(settings.products || []), ...tasks.map(t => t.product).filter(Boolean)]);
  const grid = document.getElementById('prodGrid');
  if (!names.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">No products yet</div><div>Type a name above and click "＋ Add product".</div></div>`; return; }
  grid.innerHTML = names.map(n => {
    const its = tasks.filter(t => t.product === n);
    const done = its.filter(t => t.status === 'done').length;
    const hours = its.reduce((s, t) => s + (+t.hours || 0), 0);
    const pct = its.length ? Math.round(done / its.length * 100) : 0;
    const last = its.map(t => t.completedAt || t.createdAt).filter(Boolean).sort().slice(-1)[0];
    const lastTxt = last ? new Date(last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const list = its.length
      ? its.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done')).map(t => `<div class="pli ${t.status === 'done' ? 'done' : ''}" data-open="${t.id}"><span class="prio-bar prio-${t.priority}" style="height:16px"></span><span class="pt2">${esc(t.title)}</span><span class="badge b-${t.status}">${STATUSES[t.status]}</span></div>`).join('')
      : `<div style="color:var(--txt-faint);font-size:13px;padding:8px 4px">No tasks yet. Add a task and tag it with this product.</div>`;
    return `<div class="prodcard"><div class="ph" data-prod="${esc(n)}" title="Open details" style="cursor:pointer"><div class="pn">${esc(n)}</div><div class="pstats"><span><b>${its.length}</b> activities</span><span><b>${done}</b> done</span><span><b>${hours}</b>h</span>${its.length ? `<span>last: <b>${lastTxt}</b></span>` : ''}</div><div class="pprog"><i style="width:${pct}%"></i></div></div><div class="pl">${list}</div></div>`;
  }).join('');
}
function createBlankProduct() {
  const inp = document.getElementById('projName');
  const name = inp.value.trim(); if (!name) { toast('Type a product name first'); return; }
  if (!settings.products) settings.products = [];
  if (settings.products.includes(name)) { toast(`"${name}" already exists`); return; }
  settings.products.push(name);
  sset('settings', settings); inp.value = ''; renderProducts();
  toast(`Product "${name}" added ✓`);
}
function openProductDetail(name) {
  const its = tasks.filter(t => t.product === name);
  const done = its.filter(t => t.status === 'done').length;
  const hours = its.reduce((s, t) => s + (+t.hours || 0), 0);
  const pct = its.length ? Math.round(done / its.length * 100) : 0;
  settings.productData = settings.productData || {};
  const pd = settings.productData[name] || { notes: '', checklist: [] };
  let checklist = JSON.parse(JSON.stringify(pd.checklist || []));
  const taskList = its.length
    ? its.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done')).map(t => `<div class="frow" data-open="${t.id}" style="margin-bottom:6px"><div class="prio-bar prio-${t.priority}" style="height:24px"></div><div class="ftitle">${esc(t.title)}<div class="fmeta"><span class="badge b-${t.status}">${STATUSES[t.status]}</span>${t.deadline ? `<span class="due">${fmtDate(t.deadline)}</span>` : ''}</div></div></div>`).join('')
    : `<div style="color:var(--txt-faint);font-size:13px">No tasks yet.</div>`;
  modalHost.innerHTML = `<div class="scrim" id="scrim"><div class="modal" onclick="event.stopPropagation()">
    <div class="mhead"><h3>📦 ${esc(name)}</h3><button class="xclose" id="mClose">✕</button></div>
    <div class="mbody">
      <div class="prod-detail-stats"><span><b>${its.length}</b> activities</span><span><b>${done}</b> done</span><span><b>${hours}h</b> logged</span><span><b>${pct}%</b> complete</span></div>
      <div class="pprog" style="margin-bottom:16px"><i style="width:${pct}%"></i></div>
      <div class="field"><label>Notes</label><textarea id="pd-notes" style="min-height:80px">${esc(pd.notes || '')}</textarea></div>
      <div class="subhead">✅ Checklist</div>
      <div id="pd-checklist" style="margin-bottom:4px"></div>
      <div class="addline" style="margin-bottom:8px"><input id="pd-ci" placeholder="Add checklist item…"><button class="btn sm primary" id="pd-ca">＋ Add</button></div>
      <div class="subhead">📋 Activities (${its.length})</div>
      ${taskList}
    </div>
    <div class="mfoot"><button class="btn danger sm" id="pd-del">🗑 Delete product</button><div style="display:flex;gap:10px"><button class="btn ghost" id="mCancel">Cancel</button><button class="btn primary" id="pd-save">Save notes</button></div></div>
  </div></div>`;
  const close = () => { modalHost.innerHTML = ''; renderProducts(); };
  document.getElementById('scrim').onclick = close;
  document.getElementById('mClose').onclick = close;
  document.getElementById('mCancel').onclick = close;
  function renderChecklist() {
    document.getElementById('pd-checklist').innerHTML = checklist.length
      ? checklist.map((item, i) => `<div class="pd-check-item"><input type="checkbox" ${item.done ? 'checked' : ''} data-chi="${i}"><span class="${item.done ? 'done' : ''}">${esc(item.text)}</span><button class="cdel" data-chd="${i}">✕</button></div>`).join('')
      : `<div style="color:var(--txt-faint);font-size:13px;margin-bottom:8px">No items yet.</div>`;
    document.querySelectorAll('[data-chi]').forEach(cb => cb.onchange = () => { checklist[+cb.dataset.chi].done = cb.checked; renderChecklist(); });
    document.querySelectorAll('[data-chd]').forEach(b => b.onclick = () => { checklist.splice(+b.dataset.chd, 1); renderChecklist(); });
  }
  renderChecklist();
  document.getElementById('pd-ca').onclick = () => { const inp2 = document.getElementById('pd-ci'); const text = inp2.value.trim(); if (!text) return; checklist.push({ text, done: false }); inp2.value = ''; renderChecklist(); };
  document.getElementById('pd-ci').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('pd-ca').click(); });
  document.getElementById('pd-save').onclick = () => { settings.productData = settings.productData || {}; settings.productData[name] = { notes: document.getElementById('pd-notes').value.trim(), checklist }; sset('settings', settings); close(); toast('Saved ✓'); };
  document.getElementById('pd-del').onclick = async () => {
    const tagged = tasks.filter(t => t.product === name);
    const tagMsg = tagged.length ? `<br><br><span style="color:var(--txt-dim);font-size:13px">${tagged.length} task(s) tagged with this product will be <b>untagged</b> (not deleted).</span>` : '';
    if (await customConfirm(`Delete <b>${esc(name)}</b>?${tagMsg}`, { yes: 'Delete', no: 'Cancel', danger: true })) {
      settings.products = (settings.products || []).filter(p => p !== name);
      if (settings.productData) delete settings.productData[name];
      if (tagged.length) { tasks.forEach(t => { if (t.product === name) t.product = ''; }); sset('tasks', tasks); }
      sset('settings', settings); close(); toast(`"${name}" deleted${tagged.length ? ` · ${tagged.length} task(s) untagged` : ''}`);
    }
  };
}
function createFromTemplate() {
  const inp = document.getElementById('projName');
  const name = inp.value.trim(); if (!name) { toast('Type a project name first'); return; }
  const tpl = settings.template || []; if (!tpl.length) { toast('Add template steps in Settings first'); return; }
  const now = new Date().toISOString();
  tpl.forEach((title, i) => { const d = new Date(); d.setDate(d.getDate() + (i + 1) * 3); tasks.unshift({ id: uid(), title, description: '', requester: '', product: name, type: 'Project document', sector: 'Engineering', source: '', project: name, deadline: d.toISOString().slice(0, 10), priority: 'medium', progress: 0, status: 'todo', blockers: '', notes: '', hours: 0, contacts: [], createdAt: now, completedAt: null }); });
  if (!settings.products.includes(name)) settings.products.push(name);
  if (!settings.projects.includes(name)) settings.projects.push(name);
  sset('settings', settings); inp.value = ''; saveTasks(); toast(`Project "${name}" created with ${tpl.length} activities ✓`);
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────
function effKind(ds) { const ex = (settings.calendar || {})[ds]; if (ex && ex.kind) return ex.kind; const dow = new Date(ds + 'T00:00:00').getDay(); if (dow === 0 || dow === 6) return 'weekend'; return 'work'; }
function renderCalendar() {
  document.getElementById('calLabel').textContent = new Date(calY, calM, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const startDow = new Date(calY, calM, 1).getDay(), daysIn = new Date(calY, calM + 1, 0).getDate();
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let cells = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell blank"></div>`;
  for (let day = 1; day <= daysIn; day++) {
    const ds = calY + '-' + String(calM + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const kind = effKind(ds), ex = (settings.calendar || {})[ds], dayTasks = tasks.filter(t => t.deadline === ds);
    const isToday = ds === todayStr(), isSel = ds === calSel, weekend = kind === 'weekend', noWork = kind === 'holiday' || kind === 'bridge';
    const label = ex && ex.label ? ex.label : (noWork ? kind : '');
    const taskHtml = dayTasks.slice(0, 3).map(t => `<div class="cal-task pl-${t.priority} ${t.status === 'done' ? 'done' : ''}">${esc(t.title)}</div>`).join('') + (dayTasks.length > 3 ? `<div class="cal-more">+${dayTasks.length - 3} more</div>` : '');
    cells += `<div class="cal-cell ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''} ${noWork ? 'noWork' : ''} ${weekend ? 'weekend' : ''}" data-day="${ds}"><div class="cal-d"><span>${day}</span>${label ? `<span class="hl">${esc(label)}</span>` : ''}</div>${taskHtml}</div>`;
  }
  document.getElementById('calGrid').innerHTML = cells; renderDayPanel();
}
function renderDayPanel() {
  const p = document.getElementById('dayPanel'); if (!calSel) { p.innerHTML = ''; return; }
  const ex = (settings.calendar || {})[calSel] || {}, kind = effKind(calSel);
  const dlabel = new Date(calSel + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const dayTasks = tasks.filter(t => t.deadline === calSel);
  const cur = ex.kind || (kind === 'weekend' ? 'weekend' : 'work');
  const kbtn = (k, l) => `<button class="k ${cur === k ? 'on' : ''}" data-kind="${k}">${l}</button>`;
  p.innerHTML = `<div class="day-panel"><h4>${dlabel}</h4>
    <div style="margin-bottom:14px"><div style="font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--txt-faint);margin-bottom:8px">Deadlines this day (${dayTasks.length})</div>
    ${dayTasks.length ? dayTasks.map(t => `<div class="frow" data-open="${t.id}"><div class="prio-bar prio-${t.priority}" style="height:24px"></div><div class="ftitle">${esc(t.title)}<div class="fmeta">${t.type ? `<span class="tag type">${esc(t.type)}</span>` : ''}<span class="badge b-${t.status}">${STATUSES[t.status]}</span></div></div></div>`).join('') : '<div style="color:var(--txt-faint);font-size:13px">Nothing due this day.</div>'}
    <button class="btn sm" id="dayAdd" style="margin-top:10px">＋ Add task on this day</button></div>
    <div class="daykind">${kbtn('work', '💼 Workday')}${kbtn('holiday', '🏖 Holiday')}${kbtn('bridge', '🌉 Bridge')}</div>
    <div class="field" style="max-width:320px;margin-top:8px"><label>Label (e.g. Carnival, company event)</label><input id="dayLabel" value="${esc(ex.label || '')}" placeholder="Optional note for this day"></div>
    </div>`;
  p.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { settings.calendar = settings.calendar || {}; const c = settings.calendar[calSel] || {}; settings.calendar[calSel] = { kind: b.dataset.kind, label: c.label || '' }; sset('settings', settings); renderCalendar(); });
  const dl = document.getElementById('dayLabel'); if (dl) dl.onblur = () => { settings.calendar = settings.calendar || {}; const c = settings.calendar[calSel] || {}; settings.calendar[calSel] = { kind: c.kind || cur, label: dl.value.trim() }; sset('settings', settings); renderCalendar(); };
  const da = document.getElementById('dayAdd'); if (da) da.onclick = () => openModal({ id: null, title: '', description: '', requester: '', product: '', type: '', sector: '', source: '', project: '', deadline: calSel, priority: 'medium', progress: 0, status: 'todo', blockers: '', notes: '', hours: 0, contacts: [] });
}

// ── IDEAS ─────────────────────────────────────────────────────────────────────
async function saveIdeas() { await sset('ideas', ideas); refreshAll(); }
function renderIdeas() {
  document.getElementById('ideaGrid').innerHTML = `<div class="idea add"><input id="ideaT" placeholder="Idea title…"><textarea id="ideaB" placeholder="Notes, future project, draft…"></textarea><button class="btn primary sm" id="ideaAdd">＋ Add idea</button></div>` + ideas.map(i => `<div class="idea"><button class="del" data-idel="${i.id}">✕</button><div class="it">${esc(i.title) || 'Untitled'}</div><div class="ib">${esc(i.body)}</div><div class="mono" style="color:var(--txt-faint);font-size:10.5px;margin-top:10px">${new Date(i.createdAt).toLocaleDateString()}</div></div>`).join('');
  const add = document.getElementById('ideaAdd');
  if (add) add.onclick = async () => { const t = document.getElementById('ideaT').value.trim(), b = document.getElementById('ideaB').value.trim(); if (!t && !b) { toast('Write something first'); return; } ideas.unshift({ id: uid(), title: t, body: b, createdAt: new Date().toISOString() }); await saveIdeas(); toast('Idea saved 💡'); };
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function pillHTML(field, i, v, total) {
  const mv = (dir, icon) => `<button class="pmv" data-mv="${field}:${i}:${dir}" title="${dir < 0 ? 'Move up' : 'Move down'}">${icon}</button>`;
  return `<span class="pill">`
    + (i > 0 ? mv(-1, '↑') : '')
    + `<span class="pill-lbl" data-pedit="${field}:${i}" title="Click to rename">${esc(v)}</span>`
    + (i < total - 1 ? mv(1, '↓') : '')
    + `<button data-rem="${field}:${i}" title="Remove">✕</button></span>`;
}
function renderSettings() {
  const listPanel = (title, desc, field) => {
    const items = settings[field] || [];
    const pills = items.map((v, i) => pillHTML(field, i, v, items.length)).join('');
    return `<div class="set-panel"><h4>${title}</h4><div class="sd">${desc}</div><div class="pills">${pills || '<span style="color:var(--txt-faint);font-size:13px">None yet.</span>'}</div><div class="addline"><input id="add-${field}" placeholder="Add new…"><button class="btn sm primary" data-add="${field}">Add</button></div></div>`;
  };
  let storedToken = ''; try { storedToken = localStorage.getItem('polaris_gh_token') || ''; } catch(e) {}
  document.getElementById('settingsBody').innerHTML = `<div class="set-grid">
    <div class="set-panel"><h4>Your name</h4><div class="sd">Used in the "Good morning" greeting on Today.</div><div class="addline"><input id="set-name" value="${esc(settings.name || '')}" placeholder="Your name"><button class="btn sm primary" id="saveName">Save</button></div></div>
    ${listPanel('Activity types', 'e.g. Project document, Mechanical test, Supplier dealing.', 'types')}
    ${listPanel('Sectors', 'Functional area the work belongs to.', 'sectors')}
    ${listPanel('Products / systems', 'Reference products powering the Products page & metrics.', 'products')}
    ${listPanel('Project template', 'Standard documents created when you start a project.', 'template')}
  </div>
  <div class="set-panel" style="margin-top:14px">
    <h4>☁️ Cloud sync — GitHub Gist</h4>
    <div class="sd">Paste your GitHub token once. Data syncs automatically between all your devices.</div>
    <div class="addline" style="margin-bottom:10px"><input id="set-token" type="password" placeholder="GitHub token  ghp_…" value="${storedToken}"><button class="btn sm primary" id="saveToken">Save token</button></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn sm" id="syncNow">↑ Sync now</button><button class="btn sm" id="loadCloud">↓ Load from cloud</button></div>
  </div>
  <div class="set-panel" style="margin-top:14px">
    <h4>Data</h4>
    <div class="sd">Saved automatically. Use a backup to move between devices or keep it safe.</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn sm" id="setExport">⬇︎ Export backup</button><button class="btn sm" id="setImport">⬆︎ Import backup</button></div>
  </div>`;

  document.getElementById('saveName').onclick = () => { settings.name = document.getElementById('set-name').value.trim(); sset('settings', settings); toast('Saved ✓'); };
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const f = b.dataset.add; const inp = document.getElementById('add-' + f); const val = inp.value.trim(); if (!val) return; settings[f] = settings[f] || []; if (!settings[f].includes(val)) settings[f].push(val); sset('settings', settings); renderSettings(); });
  document.querySelectorAll('[data-rem]').forEach(b => b.onclick = () => { const [f, i] = b.dataset.rem.split(':'); settings[f].splice(+i, 1); sset('settings', settings); renderSettings(); });
  document.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const [f, i, d] = b.dataset.mv.split(':'); const arr = settings[f]; const to = +i + +d; if (to < 0 || to >= arr.length) return; [arr[+i], arr[to]] = [arr[to], arr[+i]]; sset('settings', settings); renderSettings(); toast('Reordered ✓'); });
  document.querySelectorAll('[data-pedit]').forEach(lbl => lbl.onclick = () => {
    const [field, idx] = lbl.dataset.pedit.split(':'); const old = settings[field][+idx];
    const inp = document.createElement('input');
    inp.value = old; inp.style.cssText = 'background:var(--panel);border:1px solid var(--accent);border-radius:6px;color:var(--txt);padding:2px 8px;font-size:13px;width:120px;font-family:inherit';
    lbl.replaceWith(inp); inp.focus(); inp.select();
    const save = () => { const nv = inp.value.trim(); if (nv && nv !== old) { settings[field][+idx] = nv; const tf = { types: 'type', sectors: 'sector', products: 'product' }[field]; if (tf) { tasks.forEach(t => { if (t[tf] === old) t[tf] = nv; }); sset('tasks', tasks); } sset('settings', settings); toast('Renamed ✓ — all tasks updated'); } renderSettings(); };
    inp.onblur = save;
    inp.onkeydown = e => { if (e.key === 'Enter') { inp.onblur = null; save(); } if (e.key === 'Escape') { inp.onblur = null; renderSettings(); } };
  });
  document.getElementById('setExport').onclick = doExport;
  document.getElementById('setImport').onclick = () => document.getElementById('importFile').click();
  document.getElementById('saveToken').onclick = () => { const v = document.getElementById('set-token').value.trim(); if (!v) { toast('Paste your GitHub token first'); return; } try { localStorage.setItem('polaris_gh_token', v); } catch(e) {} toast('Token saved ✓ — syncing…'); gistSave(); };
  document.getElementById('syncNow').onclick = () => gistSave();
  document.getElementById('loadCloud').onclick = async () => { const ok = await gistLoad(); if (ok) { tasks = lsGet('tasks') || tasks; vocab = lsGet('vocab') || vocab; ideas = lsGet('ideas') || ideas; const s = lsGet('settings'); if (s) settings = { ...DEFAULTS, ...s }; refreshAll(); toast('Loaded from cloud ✓'); } else toast('Nothing loaded — check your token'); };
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────────
function doExport() { const blob = new Blob([JSON.stringify({ tasks, vocab, ideas, settings, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'polaris-backup-' + todayStr() + '.json'; a.click(); toast('Backup downloaded ⬇︎'); }
function doImport(file) { const r = new FileReader(); r.onload = async () => { try { const d = JSON.parse(r.result); if (!await customConfirm('Import will replace all current data.\nThis cannot be undone.', { yes: 'Import', no: 'Cancel', danger: true })) return; tasks = d.tasks || []; vocab = d.vocab || []; ideas = d.ideas || []; if (d.settings) settings = { ...DEFAULTS, ...d.settings }; await sset('tasks', tasks); await sset('vocab', vocab); await sset('ideas', ideas); await sset('settings', settings); refreshAll(); toast('Backup restored ✓'); } catch(e) { toast('Invalid backup file'); } }; r.readAsText(file); }

// ── INLINE PICKERS ────────────────────────────────────────────────────────────
function showStatusPicker(id, anchorEl) {
  document.querySelectorAll('.inline-picker').forEach(p => p.remove());
  const t = getTask(id); if (!t) return;
  const r = anchorEl.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'inline-picker';
  pop.style.cssText = `position:fixed;top:${r.bottom + 4}px;left:${Math.min(r.left, window.innerWidth - 170)}px;z-index:55;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:5px;display:flex;flex-direction:column;gap:3px;min-width:150px;box-shadow:0 10px 30px -8px #000`;
  pop.innerHTML = Object.entries(STATUSES).map(([k, v]) => `<button data-sv="${k}" style="text-align:left;padding:7px 11px;border-radius:7px;border:0;background:${t.status === k ? 'var(--accent-soft)' : 'transparent'};color:${t.status === k ? 'var(--accent)' : 'var(--txt)'};font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">${v}</button>`).join('');
  document.body.appendChild(pop);
  pop.querySelectorAll('[data-sv]').forEach(b => b.onclick = async ev => {
    ev.stopPropagation(); pop.remove();
    await inlineEdit(id, 'status', b.dataset.sv);
    if (current === 'table') renderTable();
  });
  const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', close, true); } };
  setTimeout(() => document.addEventListener('click', close, true), 10);
}
function showProgressPicker(id, anchorEl) {
  document.querySelectorAll('.inline-picker').forEach(p => p.remove());
  const t = getTask(id); if (!t) return;
  const r = anchorEl.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'inline-picker';
  pop.style.cssText = `position:fixed;top:${r.bottom + 4}px;left:${Math.min(r.left, window.innerWidth - 240)}px;z-index:55;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;min-width:220px;box-shadow:0 10px 30px -8px #000`;
  pop.innerHTML = `<div style="font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--txt-faint);margin-bottom:8px">Progress — <b id="pop-pv" style="color:var(--txt)">${t.progress || 0}</b>%</div><input type="range" id="pop-prog" min="0" max="100" step="5" value="${t.progress || 0}" style="width:100%;accent-color:var(--accent)"><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button id="pop-cancel" class="btn sm ghost">Cancel</button><button id="pop-save" class="btn sm primary">Save</button></div>`;
  document.body.appendChild(pop);
  pop.querySelector('#pop-prog').oninput = e => { pop.querySelector('#pop-pv').textContent = e.target.value; };
  pop.querySelector('#pop-cancel').onclick = ev => { ev.stopPropagation(); pop.remove(); };
  pop.querySelector('#pop-save').onclick = async ev => {
    ev.stopPropagation(); const val = parseInt(pop.querySelector('#pop-prog').value); pop.remove();
    await inlineEdit(id, 'progress', val);
    if (current === 'table') renderTable();
  };
  const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', close, true); } };
  setTimeout(() => document.addEventListener('click', close, true), 10);
}

// ── VIEWS / EVENTS ────────────────────────────────────────────────────────────
function show(view) {
  current = view;
  ['today', 'board', 'calendar', 'table', 'metrics', 'products', 'vocab', 'ideas', 'settings'].forEach(v => document.getElementById('view-' + v).classList.toggle('hide', v !== view));
  document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('on', t.dataset.tab === view));
  document.getElementById('pageTitle').textContent = TITLES[view];
  closeDrawer(); updateTabCounts(); renderCurrent();
}
function renderCurrent() { ({ today: renderToday, board: renderBoard, calendar: renderCalendar, metrics: renderMetrics, products: renderProducts, vocab: renderVocab, ideas: renderIdeas, settings: renderSettings, table: () => { renderFilters(); renderTable(); } }[current])(); }
function updateTabCounts() {
  document.getElementById('c-today').textContent = tasks.filter(t => t.status !== 'done' && ((relDays(t.deadline) !== null && relDays(t.deadline) <= 0) || replyDue(t))).length;
  document.getElementById('c-board').textContent = tasks.filter(t => t.status !== 'done').length;
  document.getElementById('c-table').textContent = tasks.length;
  document.getElementById('c-vocab').textContent = vocab.length;
  document.getElementById('c-ideas').textContent = ideas.length;
}
function refreshAll() { updateTabCounts(); renderCurrent(); }
function closeDrawer() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('drawerScrim').classList.remove('show'); }

let tt;
function toast(m) { const el = document.getElementById('toast'); el.textContent = m; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2200); }

document.addEventListener('click', e => {
  const nav = e.target.closest('.nav-item'); if (nav) { show(nav.dataset.tab); return; }
  const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; renderFilters(); renderTable(); return; }
  const sq = e.target.closest('[data-sq]'); if (sq) { const [col, dir] = sq.dataset.sq.split(':'); sortCol = col; sortDir = parseInt(dir); renderFilters(); renderTable(); return; }
  const bf = e.target.closest('[data-bf]'); if (bf) { boardFilter = bf.dataset.bf; renderBoard(); return; }
  const mp = e.target.closest('[data-mp]'); if (mp) { metricPeriod = mp.dataset.mp; renderMetrics(); return; }
  const th = e.target.closest('th[data-sort]'); if (th) { const c = th.dataset.sort; if (sortCol === c) sortDir *= -1; else { sortCol = c; sortDir = 1; } renderTable(); return; }
  const star = e.target.closest('[data-star]'); if (star) { e.stopPropagation(); toggleFocus(star.dataset.star); return; }
  const td = e.target.closest('[data-toggle-done]'); if (td) { e.stopPropagation(); const t = getTask(td.dataset.toggleDone); const wasDone = t.status === 'done'; inlineEdit(td.dataset.toggleDone, 'status', wasDone ? 'in_progress' : 'done').then(() => { renderToday(); toast(wasDone ? 'Reopened' : 'Done ✓'); }); return; }
  const dc = e.target.closest('[data-day]'); if (dc && !dc.classList.contains('blank')) { calSel = dc.dataset.day; renderCalendar(); return; }
  const istat = e.target.closest('[data-istat]'); if (istat) { showStatusPicker(istat.dataset.istat, istat); return; }
  const iprog = e.target.closest('[data-iprog]'); if (iprog) { showProgressPicker(iprog.dataset.iprog, iprog); return; }
  const prd = e.target.closest('[data-prod]'); if (prd) { openProductDetail(prd.dataset.prod); return; }
  const op = e.target.closest('[data-open]'); if (op) { openModal(getTask(op.dataset.open)); return; }
  const cy = e.target.closest('[data-cycle]'); if (cy) { const v = vocab.find(x => x.id === cy.dataset.cycle); const seq = ['new', 'learning', 'known']; v.status = seq[(seq.indexOf(v.status) + 1) % 3]; saveVocab(); renderVocab(); updateTabCounts(); return; }
  const ka = e.target.closest('[data-kadd]'); if (ka) { openModal({ id: null, title: '', description: '', requester: '', product: '', type: '', sector: '', source: '', project: '', deadline: '', priority: 'medium', progress: 0, status: ka.dataset.kadd, blockers: '', notes: '', hours: 0, contacts: [] }); return; }
  const idel = e.target.closest('[data-idel]'); if (idel) { ideas = ideas.filter(i => i.id !== idel.dataset.idel); saveIdeas(); return; }
});

document.getElementById('boardNew').onclick = () => openModal(null);
document.getElementById('fab').onclick = () => openModal(null);
document.getElementById('mineBtn').onclick = mineVocab;
document.getElementById('flashBtn').onclick = toggleFlash;
document.getElementById('projCreate').onclick = createFromTemplate;
document.getElementById('projBlank').onclick = createBlankProduct;
document.getElementById('search').oninput = e => { search = e.target.value; if (current === 'table') { renderFilters(); renderTable(); } if (current === 'board') renderBoard(); };
document.getElementById('exportBtn').onclick = doExport;
document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
document.getElementById('importFile').onchange = e => { if (e.target.files[0]) doImport(e.target.files[0]); };
document.getElementById('calPrev').onclick = () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCalendar(); };
document.getElementById('calNext').onclick = () => { calM++; if (calM > 11) { calM = 0; calY++; } renderCalendar(); };
document.getElementById('calToday').onclick = () => { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); calSel = todayStr(); renderCalendar(); };
document.getElementById('collapseBtn').onclick = () => { const sb = document.getElementById('sidebar'); sb.classList.toggle('collapsed'); settings.collapsed = sb.classList.contains('collapsed'); sset('settings', settings); };
document.getElementById('hamb').onclick = () => { document.getElementById('sidebar').classList.add('open'); document.getElementById('drawerScrim').classList.add('show'); };
document.getElementById('drawerScrim').onclick = closeDrawer;

// ── INIT ──────────────────────────────────────────────────────────────────────
(async function init() {
  await gistLoad();
  settings = { ...DEFAULTS, ...(await sget('settings', {})) };
  tasks = await sget('tasks', null);
  if (tasks === null) { tasks = seed(); await sset('tasks', tasks); }
  tasks.forEach(t => {
    if (!t.sector && t.origin) t.sector = { engineering: 'Engineering', production: 'Production', personal: 'Personal', other_sector: 'Maintenance' }[t.origin] || '';
    if (!('type' in t)) t.type = '';
    if (!('source' in t)) t.source = '';
    if (!('project' in t)) t.project = '';
    if (!('sprint' in t)) t.sprint = false;
    if (!Array.isArray(t.contacts)) t.contacts = [];
  });
  if (tasks.some(t => !t.num)) { const ord = [...tasks].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)); ord.forEach((t, i) => { if (!t.num) t.num = i + 1; }); await sset('tasks', tasks); }
  vocab = await sget('vocab', []); ideas = await sget('ideas', []);
  if (settings.collapsed) document.getElementById('sidebar').classList.add('collapsed');
  const n = new Date(); calY = n.getFullYear(); calM = n.getMonth();
  if (!getToken()) setSyncStatus('idle', 'Token not set — open Settings to enable sync');
  show('today');
})();

function seed() {
  const iso = o => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };
  const now = new Date().toISOString();
  return [
    { id: uid(), title: 'Review pump assembly drawing', description: 'Check tolerances and update the bill of materials before release.', requester: 'Carlos', product: 'P-204 Pump', type: 'Project document', sector: 'Production', source: 'Coordinator', project: '', deadline: iso(-1), priority: 'urgent', progress: 40, status: 'in_progress', blockers: 'Waiting for supplier datasheet.', notes: '', hours: 3, contacts: [{ id: uid(), name: 'BearingCo', note: 'Sent the datasheet request, no reply yet.', ball: 'them', at: now }], createdAt: now, completedAt: null },
    { id: uid(), title: 'Specify gearbox for conveyor line', description: 'Calculate torque and select the gearbox ratio.', requester: 'Planning', product: 'Conveyor C-12', type: 'Mechanical test', sector: 'Engineering', source: 'Project Sprint', project: 'Conveyor revamp', deadline: iso(0), priority: 'high', progress: 10, status: 'todo', blockers: '', notes: '', hours: 0, contacts: [], createdAt: now, completedAt: null },
    { id: uid(), title: 'Confirm motor price with supplier', description: 'Negotiate lead time and confirm the quote for the new motor.', requester: 'Purchasing', product: 'Conveyor C-12', type: 'Supplier dealing', sector: 'Engineering', source: 'Director', project: 'Conveyor revamp', deadline: iso(1), priority: 'high', progress: 20, status: 'in_progress', blockers: '', notes: '', hours: 1, contacts: [{ id: uid(), name: 'WEG Motors', note: 'They sent the revised quote — needs my reply to close it.', ball: 'me', at: now }], createdAt: now, completedAt: null },
    { id: uid(), title: 'Update maintenance procedure', description: 'Rewrite the lubrication steps for the new bearings.', requester: 'Maintenance', product: 'Line 3', type: 'System registration', sector: 'Maintenance', source: 'Production', project: '', deadline: iso(3), priority: 'medium', progress: 0, status: 'blocked', blockers: 'Need sign-off from the safety team.', notes: '', hours: 1, contacts: [], createdAt: now, completedAt: null },
    { id: uid(), title: 'Dimension support bracket', description: 'Finite element check on the new bracket design.', requester: 'Engineering', product: 'P-204 Pump', type: 'Mechanical test', sector: 'Engineering', source: 'Project Sprint', project: '', deadline: iso(5), priority: 'low', progress: 100, status: 'done', blockers: '', notes: '', hours: 4, contacts: [], createdAt: now, completedAt: now },
  ];
}
