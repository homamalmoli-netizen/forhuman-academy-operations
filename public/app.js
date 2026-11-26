// ForHuman Academy & Operations – Oberfläche (ohne Build-Schritt, reine ES-Module).
import { icon } from './icons.js';
import { t, LANG_NAMES, SPEECH, RTL } from './i18n.js';
import { classifyCode } from '/shared/codes.js';

const $app = document.getElementById('app');
const S = {
  config: null, me: null,
  lang: localStorage.getItem('fh_lang') || 'de',
  branch: Number(localStorage.getItem('fh_branch')) || null,
  shift: localStorage.getItem('fh_shift') || 'open',
  photo: null, // { id } nach Upload
  flash: null,
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tr = (k) => t(k, S.lang);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : '–');

// --- API -----------------------------------------------------------------
class ApiError extends Error { constructor(status, body) { super(body?.message || 'Fehler'); this.status = status; this.body = body; } }
async function api(method, path, body, raw) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: raw ? { 'x-fh-request': '1', 'content-type': raw } : { 'x-fh-request': '1', 'content-type': 'application/json' },
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: 'offline', message: tr('not_saved_offline') });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b || {});
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

async function uploadPhoto(file, purpose) {
  const blob = file.type === 'application/pdf' ? file : await shrinkImage(file);
  return api('POST', `/api/media?${qs({ branch: S.branch, purpose })}`, blob, blob.type || 'application/octet-stream');
}
async function shrinkImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', 0.82));
  } catch { return file; }
}

// --- Grundgerüst -------------------------------------------------------------
function setLang(l) {
  S.lang = l; localStorage.setItem('fh_lang', l);
  document.documentElement.lang = l;
  document.documentElement.dir = RTL.has(l) ? 'rtl' : 'ltr';
  if (S.me) api('PUT', '/api/me/lang', { lang: l }).catch(() => {});
}
function roles() { return S.me?.branches.find((b) => b.id === S.branch)?.roles || []; }
const isManager = () => roles().some((r) => ['manager', 'admin'].includes(r));
const isTrainer = () => roles().some((r) => ['trainer', 'admin'].includes(r));
const isShiftLead = () => roles().some((r) => ['shift_lead', 'manager', 'admin'].includes(r));
const levelLabel = (l) => tr('level_' + l);

function shell(content, { tabs = true } = {}) {
  const demo = S.config?.demo ? `<div class="demo-banner" role="status">${esc(tr('demo_banner'))}</div>` : '';
  const off = `<div id="offline-banner" class="offline" role="alert" ${navigator.onLine ? 'hidden' : ''}>${esc(tr('offline'))}</div>`;
  // Meldung bleibt sichtbar, bis die Person die nächste Aktion ausführt (kein Verschwinden durch Neuaufbau).
  const flash = S.flash ? `<div class="flash ${S.flash.type}" role="status">${esc(S.flash.text)}</div>` : '';
  const r = location.hash;
  const tab = (href, ic, label) => `<a href="${href}" class="tab ${r.startsWith(href) ? 'on' : ''}">${icon(ic)}<span>${esc(label)}</span></a>`;
  const nav = tabs && S.me ? `<nav class="tabs" aria-label="Navigation">
      ${tab('#/shift', 'list', tr('tab_tasks'))}${tab('#/cleaning', 'spray', tr('tab_cleaning'))}${tab('#/timer', 'history', tr('tab_timer'))}${tab('#/learn', 'school', tr('tab_learn'))}${tab('#/more', 'dash', tr('tab_more'))}
      ${isManager() || isTrainer() || isShiftLead() ? tab('#/manage', 'settings', tr('tab_manage')) : ''}</nav>` : '';
  const branchName = S.me?.branches.find((b) => b.id === S.branch)?.name;
  const head = S.me ? `<header class="top">
      <div class="brand"><img src="/logo.svg" alt="" width="34" height="34"><div><b>ForHuman</b><small>${esc(tr('app_name'))}</small></div></div>
      <div class="top-right">
        ${S.me.branches.length > 1 ? `<select data-change="branch" aria-label="${esc(tr('branch'))}">${S.me.branches.map((b) => `<option value="${b.id}" ${b.id === S.branch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : `<span class="pill">${esc(branchName || '')}</span>`}
        <select data-change="lang" aria-label="${esc(tr('choose_lang'))}">${Object.keys(LANG_NAMES).map((k) => `<option value="${k}" ${k === S.lang ? 'selected' : ''}>${k.toUpperCase()}</option>`).join('')}</select>
        <button class="icon-btn" data-action="logout" title="${esc(tr('logout'))}" aria-label="${esc(tr('logout'))}">${icon('logout')}</button>
      </div></header>` : '';
  $app.innerHTML = `${demo}${off}${head}<main id="main" tabindex="-1">${flash}${content}</main>${nav}`;
}

// Nur das Ergebnis des zuletzt gestarteten Seitenaufbaus anzeigen (verhindert, dass langsame Antworten neuere Eingaben überschreiben)
let renderSeq = 0;
const render = (seq, ...args) => { if (seq === renderSeq) shell(...args); };

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH[S.lang] || 'de-DE';
  speechSynthesis.speak(u);
}
const canSpeak = () => 'speechSynthesis' in window;

function errorBox(e) {
  if (S.flash && S.flash.text === (e?.body?.message || e?.message)) return '';
  return `<div class="flash error" role="alert">${esc(e?.body?.message || e?.message || tr('error'))}</div>`;
}
function showError(e) {
  S.flash = { type: 'error', text: e?.body?.message || e?.message || tr('error') };
  if (e?.status === 0) {
    // Offline: Bildschirm (und Eingaben) behalten, nur die Fehlermeldung zeigen. Nichts wurde gespeichert.
    document.querySelectorAll('main .flash').forEach((f) => f.remove());
    document.getElementById('main')?.insertAdjacentHTML('afterbegin', `<div class="flash error" role="alert">${esc(S.flash.text)}</div>`);
    document.querySelectorAll('button:disabled').forEach((b) => { if (!b.closest('[data-keep-disabled]')) b.disabled = false; });
    window.scrollTo(0, 0);
    return;
  }
  route();
}

// --- Start / Anmeldung -------------------------------------------------------------
function viewStart() {
  const langs = Object.entries(LANG_NAMES).map(([k, v]) => `<button class="lang-btn ${k === S.lang ? 'on' : ''}" data-action="set-lang" data-lang="${k}" lang="${k}">${v}</button>`).join('');
  const demo = S.config.demo ? `<section class="card"><h2>${esc(tr('try_demo_as'))}</h2><div class="persona-grid">
      ${['employee_halle', 'employee_leuna', 'shift_lead_halle', 'manager_halle', 'manager_leuna', 'trainer', 'admin'].map((p) => `<button class="big-btn" data-action="demo" data-persona="${p}">${icon(p.startsWith('employee') ? 'user' : p === 'admin' ? 'settings' : p === 'trainer' ? 'school' : p.startsWith('shift_lead') ? 'star' : 'dash')}<span>${esc(tr('persona_' + p))}</span></button>`).join('')}
    </div></section>` : `<section class="card"><h2>${esc(tr('login'))}</h2>
      ${S.config.has_admin ? '' : `<p class="note">${esc(tr('no_admin_yet'))}</p>`}
      <form data-submit="login" class="form">
        <label>${esc(tr('username'))}<input name="username" autocomplete="username" required></label>
        <label>${esc(tr('password'))}<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="primary">${esc(tr('login'))}</button>
      </form></section>`;
  const inviteForm = `<details class="card"><summary>${icon('lock')} ${esc(tr('invite_login'))}</summary>
      <form data-submit="redeem" class="form"><label>${esc(tr('invite_code'))}<input name="code" autocomplete="one-time-code" required placeholder="XXXX-XXXX-XXXX"></label>
        <label>${esc(tr('new_password'))}<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
        <label>${esc(tr('repeat_password'))}<input name="password2" type="password" autocomplete="new-password" minlength="10" required></label>
        <button class="primary">${esc(tr('set_password'))}</button></form></details>`;
  shell(`<div class="start">
      <div class="hero"><img src="/logo.svg" alt="" width="84" height="84"><h1>ForHuman Fried Chicken</h1><p>${esc(tr('app_name'))}</p></div>
      <section class="card"><h2>${icon('lang')} ${esc(tr('choose_lang'))}</h2><div class="lang-grid">${langs}</div></section>
      ${demo}${inviteForm}</div>`, { tabs: false });
}

// --- Mitarbeiter: eine Aufgabe pro Bildschirm -----------------------------------------
function taskCard(n) {
  const sayText = `${n.title}. ${n.hint || ''}`;
  return `<article class="task-card ${n.status === 'rework' ? 'rework' : ''}" data-task="${n.id}">
        ${n.status === 'rework' ? `<div class="tag warn">${icon('history')} ${esc(tr('rework'))}</div>` : `<div class="tag">${esc(tr('next_task'))}</div>`}
        <div class="station-tag">${n.station ? esc(n.station) : esc(tr('general'))}</div>
        ${n.overdue ? `<div class="tag warn">${icon('warn')} ${esc(tr('overdue'))} · ${esc(new Date(n.work_date).toLocaleDateString('de-DE'))}</div>` : ''}
        ${n.cleaning_agent ? `<p class="note">${esc(tr('cleaning_agent'))}: <b>${esc(n.cleaning_agent)}</b></p>` : ''}
        <div class="task-icon">${icon(n.icon, 'huge')}</div>
        <h1 class="task-title">${esc(n.title)}</h1>
        ${n.hint ? `<p class="task-hint">${esc(n.hint)}</p>` : ''}
        ${n.measure_unit ? `<label class="value-input">${esc(tr('enter_value'))}<span><input id="value" inputmode="decimal" type="number" step="0.1" aria-label="${esc(tr('enter_value'))}"> ${esc(n.measure_unit)}</span></label>` : ''}
        ${n.requires_photo ? photoField('evidence', tr('photo_required')) : ''}
        <div class="actions">
          ${canSpeak() ? `<button class="act" data-action="speak" data-text="${esc(sayText)}">${icon('speak')}<span>${esc(tr('btn_speak'))}</span></button>` : ''}
          ${n.sop_id ? `<a class="act" href="#/sop/${n.sop_id}">${icon('book')}<span>${esc(tr('btn_guide'))}</span></a>` : ''}
          ${n.link === 'inventory' ? `<a class="act" href="#/inventory">${icon('box')}<span>${esc(tr('open_inventory'))}</span></a>` : ''}
          ${n.link === 'daily_early' || n.link === 'daily_late' ? `<a class="act" href="#/daily/${n.link === 'daily_early' ? 'early' : 'late'}">${icon('box')}<span>${esc(tr('daily_inventory'))}</span></a>` : ''}
          ${n.link === 'pest_check' ? `<a class="act" href="#/pest">${icon('bug')}<span>${esc(tr('pest_check'))}</span></a>` : ''}
          ${n.link === 'marinade' ? `<a class="act" href="#/marinade">${icon('prep')}<span>${esc(tr('marinade'))}</span></a>` : ''}
          ${n.link === 'goods' ? `<a class="act" href="#/goods">${icon('scan')}<span>${esc(tr('tab_goods'))}</span></a>` : ''}
          ${n.link === 'oil_check' || n.link === 'oil_change' ? `<a class="act" href="#/oil">${icon('oil')}<span>${esc(tr('tab_oil'))}</span></a>` : ''}
          <a class="act warn" href="#/problem/${n.id}">${icon('warn')}<span>${esc(tr('btn_problem'))}</span></a>
        </div>
        <button class="done-btn" data-action="complete" data-id="${n.id}">${icon('check')}<span>${esc(tr('btn_done'))}</span></button>
      </article>`;
}

async function viewShift() {
  const __seq = renderSeq;
  const shiftBtns = ['open', 'run', 'close'].map((s) => `<button class="seg ${S.shift === s ? 'on' : ''}" data-action="set-shift" data-shift="${s}">${icon(s === 'open' ? 'sun' : s === 'run' ? 'run' : 'moon')}<span>${esc(tr('shift_' + s))}</span></button>`).join('');
  let d;
  try { d = await get(`/api/shift/next?${qs({ branch: S.branch, shift: S.shift, lang: S.lang })}`); }
  catch (e) { return render(__seq, `<div class="segs">${shiftBtns}</div>${errorBox(e)}`); }
  const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
  const mine = await get(`/api/my-stations?${qs({ branch: S.branch, shift: S.shift, lang: S.lang })}`).catch(() => []);
  const stationHead = mine.length
    ? `<section class="station-head"><small>${esc(tr('my_station_today'))}</small><div class="chips">${mine.map((m) => `<span class="chip on">${icon(m.icon)} ${esc(m.name)}${m.training ? ` · ${esc(tr('in_training'))}` : ''}</span>`).join('')}</div></section>`
    : d.personal ? '' : `<p class="note center">${esc(tr('no_plan'))}</p>`;
  const groups = `<div class="groups">${d.groups.map((g) => `<div class="group ${g.done === g.total ? 'complete' : ''}"><span>${g.station_id ? esc(g.station) : esc(tr('general'))}</span><b>${g.done}/${g.total}</b></div>`).join('')}</div>`;
  const progress = `${stationHead}<div class="progress"><span>${d.done} ${esc(tr('of'))} ${d.total}</span><progress max="100" value="${pct}" aria-label="${pct}%"></progress></div>${groups}${d.other_station_tasks ? `<p class="note center">${esc(tr('other_station_tasks'))} (${d.other_station_tasks})</p>` : ''}`;
  const presence = d.personal
    ? `<p class="personal-head">${icon('user')} <b>${esc(tr('my_tasks'))}</b>${d.team_open ? ` · ${d.team_open} ${esc(tr('team_open'))}` : ''}</p>`
    : `<button class="secondary block" data-action="presence">${icon('user')} ${esc(tr('i_work_this_shift'))}</button>`;
  let body;
  const n = d.next;
  if (!n) {
    body = `<section class="card center done-card">${icon('check', 'huge ok')}<h2>${esc(tr('all_done'))}</h2>${d.problems ? `<p>${esc(tr('problem_open_wait'))}</p>` : ''}</section>`;
  } else {
    S.current = n;
    body = `${taskCard(n)}
      <a class="pest-link" href="#/pest">${icon('bug')} ${esc(tr('pest_found'))}</a>`;
  }
  const trainings = d.open_trainings?.length ? `<section class="card banner-card">${icon('school')} <b>${esc(tr('open_trainings'))}</b>
      <ul class="plain">${d.open_trainings.map((o) => `<li><a href="#/learn/${o.course_id}">${esc(o.title)}</a>${o.expired ? ` <small class="badge warn">${esc(tr('expired_training'))}</small>` : ''}</li>`).join('')}</ul></section>` : '';
  const blocked = d.blocked.length ? `<section class="card muted"><h3>${icon('lock')} ${esc(tr('blocked_tasks'))}</h3>
      <ul class="plain">${d.blocked.map((b) => `<li>${icon(b.icon)} ${esc(b.title)}${b.station ? ` <small>(${esc(b.station)})</small>` : ''} ${b.reason === 'course' ? `<a href="#/learn/${b.required_course_id}">${esc(tr('tab_learn'))} →</a>` : `<small class="badge warn">${esc(tr('needs_station_check'))}</small>`}</li>`).join('')}</ul></section>` : '';
  const ctl = await get(`/api/controls/mine?branch=${S.branch}`).catch(() => ({ runs: [], reminders: [] }));
  const ctlOpen = ctl.runs.filter((r) => r.state !== 'done' && r.state !== 'late_done');
  const controls = (ctl.reminders.length || ctlOpen.length) ? `<section class="card banner-card controls-card">
      ${ctl.reminders.map((m) => `<p class="reminder">${icon('warn')} ${esc(m.message)} <button class="small" data-action="note-read" data-id="${m.id}">${esc(tr('dismiss'))}</button></p>`).join('')}
      ${ctlOpen.map((r) => `<a class="ctl-row ${r.state}" href="#/control/${r.id}">${icon(r.marinated ? 'prep' : 'box')} <b>${esc(r.list)}</b>
        <span>${esc(tr('control_due'))} ${esc(r.due_time)}</span><span class="badge ${r.state === 'overdue' || r.state === 'rework' ? 'change' : 'warn'}">${esc(tr('ctl_' + r.state))}</span></a>`).join('')}</section>` : '';
  render(__seq, `<div class="segs">${shiftBtns}</div>${presence}${controls}${progress}${trainings}${body}${blocked}`);
}

// --- Kontrolllisten (Ist-Mengen, keine Warenwirtschaft) ------------------------------------
async function viewControls() {
  const __seq = renderSeq;
  let d;
  try { d = await get(`/api/controls/mine?branch=${S.branch}`); } catch (e) { return render(__seq, errorBox(e)); }
  render(__seq, `<h1 class="page-title">${icon('box')} ${esc(tr('my_controls'))}</h1>
    ${d.runs.length ? `<div class="course-list">${d.runs.map((r) => `<a class="course" href="#/control/${r.id}">${icon(r.marinated ? 'prep' : 'box', 'big')}
      <div><b>${esc(r.list)}</b><small>${esc(tr('control_due'))} ${esc(r.due_time)}${r.assigned_name ? ' · ' + esc(r.assigned_name) : ''}</small></div>
      <span class="badge ${['done', 'late_done'].includes(r.state) ? 'ok' : r.state === 'open' ? 'warn' : 'change'}">${esc(tr('ctl_' + r.state))}</span></a>`).join('')}</div>`
      : `<p class="note">${esc(tr('no_controls'))}</p>`}`);
}

async function viewControl(id) {
  const __seq = renderSeq;
  let r;
  try { r = await get(`/api/controls/runs/${id}`); } catch (e) { return render(__seq, errorBox(e)); }
  const done = ['done', 'late_done'].includes(r.state);
  const nowLocal = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
  const row = (i) => `<li class="ctl-item ${i.reorder ? 'below' : ''}"><div class="ctl-name"><b>${esc(i.name)}</b>
      <small>${i.unit === 'offen' ? esc(tr('unit_open')) : esc(i.unit)} · ${i.min_qty == null ? esc(tr('min_open')) : `${esc(tr('min_qty'))} ${i.min_qty}`}</small>
      ${i.reorder ? `<span class="badge change">${esc(tr('below_min'))}</span>` : ''}</div>
      <input name="qty_${i.id}" type="number" inputmode="decimal" step="0.01" min="0" required value="${i.qty ?? ''}" ${done ? 'disabled' : ''} aria-label="${esc(tr('qty_actual'))} ${esc(i.name)}">
      ${r.marinated ? `<label class="ctl-sub">${esc(tr('marinated_at'))}<input name="mat_${i.id}" type="datetime-local" value="${esc(i.marinated_at || '')}" max="${nowLocal()}" ${done ? 'disabled' : ''}></label>
        ${i.use_by ? `<small>${esc(tr('use_by_short'))} ${fmtTime(i.use_by)}</small>` : ''}` : ''}</li>`;
  render(__seq, `<a class="back-link" href="#/controls">${icon('back')} ${esc(tr('my_controls'))}</a>
    <form data-submit="control" data-id="${r.id}" class="card form"><h1>${icon(r.marinated ? 'prep' : 'box')} ${esc(r.list)}</h1>
      <p><span class="badge ${done ? 'ok' : r.state === 'open' ? 'warn' : 'change'}">${esc(tr('ctl_' + r.state))}</span> ${esc(tr('control_due'))} <b>${esc(r.due_time)}</b>${r.assigned_name ? ' · ' + esc(r.assigned_name) : ''}</p>
      ${r.review_note ? `<div class="banner">${icon('warn')} ${esc(r.review_note)}</div>` : ''}
      <p class="note">${esc(tr('zero_ok'))}</p>
      <ul class="plain ctl-list">${r.items.map(row).join('')}</ul>
      ${r.marinated ? `<label>${esc(tr('temperature_c'))}<input name="temperature" type="number" inputmode="decimal" step="0.1" required value="${r.temperature ?? ''}" ${done ? 'disabled' : ''}></label>
        ${r.use_within_hours ? '' : `<p class="note">${esc(tr('use_by_open'))}</p>`}` : ''}
      ${done ? '' : `${r.photo_required ? photoField('evidence', tr('take_photo')) : photoField('evidence', tr('take_photo') + ' (optional)')}
      <button class="primary block">${icon('check')} ${esc(tr('send'))}</button>`}
    </form>`);
}

// (Kontrolllisten-Ende)


function photoField(purpose, label) {
  const ready = S.photo && S.photo.purpose === purpose;
  return `<div class="photo-field ${ready ? 'ready' : ''}">
      <label class="photo-btn">${icon('camera')}<span>${esc(ready ? tr('photo_ok') : label || tr('take_photo'))}</span>
      <input type="file" accept="image/*${purpose === 'receipt' || purpose === 'certificate' ? ',application/pdf' : ''}" ${purpose === 'certificate' ? '' : 'capture="environment"'} data-change="photo" data-purpose="${purpose}" hidden></label>
      ${ready && S.photo.preview ? `<img class="thumb" src="${S.photo.preview}" alt="">` : ''}</div>`;
}

async function completeTask(id) {
  const n = S.current;
  const body = {};
  if (n?.measure_unit) body.value = document.getElementById('value')?.value;
  if (S.photo?.purpose === 'evidence') body.media_id = S.photo.id;
  try {
    const r = await post(`/api/tasks/${id}/complete`, body);
    S.photo = null;
    S.flash = { type: r.deviation ? 'error' : 'ok', text: r.deviation ? 'Grenzwert verletzt – Leitung ist informiert.' : tr('saved') };
    if (location.hash.startsWith('#/task/')) { history.back(); return; }
    route();
  } catch (e) { showError(e); }
}

function viewProblem(taskId) {
  shell(`<section class="card"><h1>${icon('warn')} ${esc(tr('btn_problem'))}</h1>
      <form data-submit="problem" data-task="${taskId || ''}" class="form">
        <label>${esc(tr('describe_problem'))}<textarea name="description" rows="3" required minlength="2"></textarea></label>
        ${photoField('problem', tr('take_photo'))}
        <div class="row"><a class="secondary" href="#/shift">${esc(tr('cancel'))}</a><button class="primary">${esc(tr('send'))}</button></div>
      </form></section>`);
}

async function viewSop(id) {
  const __seq = renderSeq;
  let s;
  try { s = await get(`/api/sops/${id}?lang=${S.lang}`); } catch (e) { return render(__seq, errorBox(e)); }
  if (!s.published) return render(__seq, `<section class="card">${esc(tr('sop_not_published'))}</section><a class="secondary" href="#/shift">${esc(tr('back'))}</a>`);
  const all = s.steps.map((x) => x.text).join(' ');
  render(__seq, `<section class="card sop">
      ${s.safety_review === 'pending' ? `<div class="banner danger">${icon('warn')} ${esc(tr('draft_not_for_use'))}</div>` : ''}
      ${!s.translation_reviewed ? `<div class="banner">${esc(tr('translation_unreviewed'))}</div>` : ''}
      <h1>${icon(s.icon)} ${esc(s.title)}</h1><p class="meta">${esc(s.code)} · Version ${s.version}</p>
      ${canSpeak() ? `<button class="act" data-action="speak" data-text="${esc(s.title + '. ' + all)}">${icon('speak')}<span>${esc(tr('btn_speak'))}</span></button>` : ''}
      <ol class="steps">${s.steps.map((x, i) => `<li><span class="num">${i + 1}</span><span class="step-ico">${icon(x.icon)}</span><p>${esc(x.text)}</p></li>`).join('')}</ol>
      <button class="secondary" data-action="back">${esc(tr('back'))}</button></section>`);
}

// --- Academy --------------------------------------------------------------------
async function viewLearn() {
  const __seq = renderSeq;
  let list, st;
  try { [list, st] = await Promise.all([get(`/api/courses?${qs({ branch: S.branch, lang: S.lang })}`), get(`/api/stations?${qs({ branch: S.branch, lang: S.lang })}`)]); } catch (e) { return render(__seq, errorBox(e)); }
  const ladder = ['new', 'crew', 'allrounder', 'trainer', 'shift_lead'];
  render(__seq, `<section class="card level-card"><small>${esc(tr('level'))}</small>
      <div class="ladder">${ladder.map((l, i) => `<span class="rung ${i < st.level.rank ? 'on' : ''} ${l === st.level.level ? 'current' : ''}">${i + 1}<small>${esc(levelLabel(l))}</small></span>`).join('')}</div>
      <p><b>${esc(levelLabel(st.level.level))}</b> · ${st.level.certified}/${st.level.total} ${esc(tr('my_stations'))}</p></section>
    <a class="primary block" href="#/train">${icon('school')} ${esc(tr('train_areas'))}</a>
    <a class="secondary block" href="#/help">${icon('book')} ${esc(tr('help_title'))}</a>
    <a class="secondary block" href="#/welcome">${icon('user')} ${esc(tr('welcome'))} & Nachweise</a>
    <a class="secondary block" href="#/handbook">${icon('book')} ${esc(tr('handbook'))}</a>
    <h2>${icon('store')} ${esc(tr('my_stations'))}</h2>
    <div class="course-list">${st.stations.map((x) => `<div class="course">${icon(x.icon, 'big')}<div><b>${esc(x.name)}</b>${x.sop_id ? `<small><a href="#/sop/${x.sop_id}">${esc(tr('btn_guide'))} →</a></small>` : ''}</div>
      ${x.certified ? `<span class="badge ok">${esc(tr('certified'))}</span>` : `<span class="badge">${esc(tr('not_certified'))}</span>`}</div>`).join('')}</div>
    <h1 class="page-title">${icon('school')} ${esc(tr('courses'))}</h1>
    <div class="course-list">${list.map((c) => {
      const state = c.ok ? `<span class="badge ok">${esc(tr('qualified'))}</span>` : c.exam && c.needsPractical ? `<span class="badge warn">${esc(tr('needs_practical'))}</span>` : `<span class="badge">${esc(tr('not_started'))}</span>`;
      const st2 = c.expired ? `<span class="badge warn">${esc(tr('expired_training'))}</span>` : state;
      return `<a class="course" href="#/learn/${c.id}">${icon(c.icon, 'big')}<div><b>${esc(c.title)}</b><small>${c.steps_done}/${c.steps} ${esc(tr('step'))} ${c.safety_critical ? '· ' + icon('shield') : ''}${c.expires_at && !c.expired ? ` · ${esc(tr('valid_until'))} ${new Date(c.expires_at).toLocaleDateString('de-DE')}` : ''}</small></div>${st2}</a>`;
    }).join('')}</div>`);
}

async function viewCourse(id) {
  const __seq = renderSeq;
  let c;
  try { c = await get(`/api/courses/${id}?${qs({ branch: S.branch, lang: S.lang })}`); } catch (e) { return render(__seq, errorBox(e)); }
  // 1) Sprache selbst wählen (vor Beginn, jederzeit vor der Prüfung änderbar)
  const langPick = `<div class="lang-grid small">${c.langs.map((l) => `<button class="lang-btn ${l === c.lang ? 'on' : ''}" data-action="set-lang" data-lang="${l}" lang="${l}">${LANG_NAMES[l]}</button>`).join('')}</div>`;
  const i = Math.min(c.steps_done, c.steps.length - 1);
  const allDone = c.steps_done >= c.steps.length;
  const stepsHtml = c.steps.map((s, k) => `<li class="${k < c.steps_done ? 'done' : k === c.steps_done ? 'current' : 'todo'}"><span class="num">${k < c.steps_done ? icon('check') : k + 1}</span><span class="step-ico">${icon(s.icon)}</span><p>${esc(s.text)}</p></li>`).join('');
  const cur = c.steps[i];
  render(__seq, `<section class="card course-view">
      <a href="#/learn" class="back-link">${icon('back')} ${esc(tr('courses'))}</a>
      <h1>${icon(c.icon)} ${esc(c.title)}</h1>
      <p>${esc(c.intro || '')}</p>
      ${!c.translation_reviewed ? `<div class="banner">${esc(tr('translation_unreviewed'))}</div>` : ''}
      <h3>${esc(tr('choose_lang'))}</h3>${langPick}
      <progress max="${c.steps.length}" value="${c.steps_done}"></progress>
      ${!allDone ? `<div class="learn-step"><div class="task-icon">${icon(cur.icon, 'huge')}</div><p class="learn-text">${esc(tr('step'))} ${i + 1}/${c.steps.length}: ${esc(cur.text)}</p>
        <div class="actions">${canSpeak() ? `<button class="act" data-action="speak" data-text="${esc(cur.text)}">${icon('speak')}<span>${esc(tr('btn_speak'))}</span></button>` : ''}</div>
        <button class="done-btn" data-action="learn-step" data-id="${c.id}" data-step="${c.steps_done}" data-lang="${c.lang}">${icon('check')}<span>${esc(tr('understood'))}</span></button></div>` : ''}
      <ol class="steps">${stepsHtml}</ol>
      ${c.safety_critical ? `<p class="note">${icon('shield')} ${esc(tr('practical_hint'))}</p>` : ''}
      ${allDone ? `<a class="primary block" href="#/exam/${c.id}">${icon('school')} ${esc(tr('start_exam'))}</a>` : `<button class="primary block" disabled>${icon('lock')} ${esc(tr('exam_locked'))}</button>`}
    </section>`);
}

async function viewExam(id) {
  const __seq = renderSeq;
  let e;
  try { e = await get(`/api/courses/${id}/exam?lang=${S.lang}`); } catch (err) { return render(__seq, errorBox(err) + `<a class="secondary" href="#/learn/${id}">${esc(tr('back'))}</a>`); }
  render(__seq, `<section class="card exam"><h1>${icon('school')} ${esc(tr('start_exam'))}</h1>
      ${!e.translation_reviewed ? `<div class="banner">${esc(tr('translation_unreviewed'))}</div>` : ''}
      <form data-submit="exam" data-id="${id}" data-lang="${e.lang}">
      ${e.questions.map((q) => `<fieldset><legend>${q.index + 1}. ${esc(q.q)}</legend>${q.image ? `<div class="q-image">${icon(q.image, 'huge')}</div>` : ''}
        ${q.options.map((o, k) => `<label class="option"><input type="radio" name="q${q.index}" value="${k}" required><span>${esc(o)}</span></label>`).join('')}</fieldset>`).join('')}
      <button class="primary block">${esc(tr('submit_exam'))}</button></form></section>`);
}

function viewExamResult(id, r, questions) {
  shell(`<section class="card exam-result ${r.passed ? 'ok' : 'fail'}">
      ${icon(r.passed ? 'check' : 'warn', 'huge')}<h1>${esc(r.passed ? tr('passed') : tr('failed'))}</h1>
      <p class="score">${r.score} / ${r.total}</p>
      <ol class="plain results">${r.results.map((x, i) => `<li class="${x.correct ? 'ok' : 'bad'}">${icon(x.correct ? 'check' : 'warn')} ${esc(questions[i]?.q || '')} – <b>${esc(x.correct ? tr('correct') : tr('wrong'))}</b>${!x.correct ? `<br><small>✓ ${esc(questions[i]?.options[x.correct_option] || '')}</small>` : ''}</li>`).join('')}</ol>
      ${r.passed && r.needs_practical && !r.practical ? `<div class="banner">${icon('shield')} ${esc(tr('needs_practical'))}. ${esc(tr('practical_hint'))}</div>` : ''}
      <div class="row">${!r.passed ? `<a class="primary" href="#/learn/${id}">${esc(tr('repeat'))}</a>` : ''}<a class="secondary" href="#/learn">${esc(tr('courses'))}</a></div>
    </section>`);
}

// --- Schulungsbereiche (10 × 3 Stufen) ----------------------------------------------------
const TST = { open: '', locked: '', preparing: 'warn', needs_practical: 'warn', certified: 'ok' };
async function viewTrain() {
  const __seq = renderSeq;
  let areas, certs;
  try { [areas, certs] = await Promise.all([get(`/api/train?${qs({ branch: S.branch, lang: S.lang })}`), get(`/api/train/certificates?lang=${S.lang}`)]); } catch (e) { return render(__seq, errorBox(e)); }
  render(__seq, `<h1 class="page-title">${icon('school')} ${esc(tr('train_areas'))}</h1><p class="note">${esc(tr('train_intro'))}</p>
    <a class="secondary block" href="#/help">${icon('book')} ${esc(tr('help_title'))}</a>
    <div class="area-list">${areas.map((a) => `<section class="card area"><h2>${icon(a.icon)} ${esc(a.title)}</h2>
      ${a.stations.length ? `<small class="note">${icon('store')} ${a.stations.map(esc).join(', ')}</small>` : ''}
      <div class="levels">${a.levels.map((l) => `<a class="level-pill ${l.state}" href="#/train/${l.id}"><b>${l.level}</b><span>${esc(l.label)}</span>
        <span class="badge ${TST[l.state]}">${esc(tr('st_' + l.state))}</span><small>${l.pool}/${l.pool_target} ${esc(tr('questions_pool'))}</small></a>`).join('')}</div></section>`).join('')}</div>
    <h2>${icon('star')} ${esc(tr('my_certificates'))}</h2><ul class="plain">${certs.map((c) => `<li>${icon('check')} <b>${esc(c.title)}</b> · ${new Date(c.issued_at).toLocaleDateString('de-DE')} · <code>${esc(c.code)}</code>${c.signed_by ? ` · ${esc(c.signed_by)}` : ''}</li>`).join('') || '<li>–</li>'}</ul>`);
}

async function viewTrainModule(id) {
  const __seq = renderSeq;
  let m;
  try { m = await get(`/api/train/modules/${id}?${qs({ branch: S.branch, lang: S.lang })}`); } catch (e) { return render(__seq, errorBox(e)); }
  const canStart = m.unlocked && m.exam_ready && m.state !== 'certified';
  render(__seq, `<a class="back-link" href="#/train">${icon('back')} ${esc(tr('train_areas'))}</a>
    <section class="card"><h1>${esc(m.title)}</h1><span class="badge ${TST[m.state]}">${esc(tr('st_' + m.state))}</span>
      ${!m.translation_reviewed ? `<div class="banner">${esc(tr('translation_unreviewed'))}</div>` : ''}
      <ol class="steps">${m.steps.map((s, k) => `<li class="todo"><span class="num">${k + 1}</span><p>${esc(s)}</p></li>`).join('')}</ol>
      ${canSpeak() ? `<div class="actions"><button class="act" data-action="speak" data-text="${esc(m.steps.join('. '))}">${icon('speak')}<span>${esc(tr('btn_speak'))}</span></button></div>` : ''}
      ${m.video_url ? `<a class="secondary block" href="${esc(m.video_url)}" target="_blank" rel="noopener noreferrer">${icon('eye')} ${esc(tr('watch_video'))}</a>` : ''}
      ${m.open_points.length ? `<div class="banner">${icon('warn')} <b>${esc(tr('open_points'))}:</b><ul>${m.open_points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <p class="note">${m.pool}/${m.pool_target} ${esc(tr('questions_pool'))} · ${esc(tr('train_intro'))}</p>
      ${m.last_attempt ? `<p class="note">${esc(m.last_attempt.passed ? tr('passed') : tr('failed'))}: ${m.last_attempt.score}/${m.last_attempt.total}</p>` : ''}
      ${m.certificate ? `<p class="badge ok">${icon('star')} ${esc(tr('st_certified'))} · ${esc(m.certificate.code)}</p>` : ''}
      ${m.state === 'needs_practical' ? `<div class="banner">${icon('shield')} ${esc(tr('practical_hint'))}</div>` : ''}
      ${canStart ? `<button class="primary block" data-action="train-start" data-id="${m.id}">${icon('school')} ${esc(m.last_attempt && !m.last_attempt.passed ? tr('repeat') : tr('start_test'))}</button>` : ''}
    </section>`);
}

async function viewTrainExam(id) {
  const __seq = renderSeq;
  let e;
  try { e = await get(`/api/train/attempts/${id}?lang=${S.lang}`); } catch (err) { return render(__seq, errorBox(err) + `<a class="secondary" href="#/train">${esc(tr('back'))}</a>`); }
  render(__seq, `<section class="card exam"><h1>${icon('school')} ${esc(e.title)}</h1>
    ${!e.translation_reviewed ? `<div class="banner">${esc(tr('translation_unreviewed'))}</div>` : ''}
    <form data-submit="train-exam" data-id="${e.id}" data-module="${e.module_id}">
    ${e.questions.map((q) => `<fieldset><legend>${q.index + 1}. ${esc(q.q)} ${q.safety ? `<span class="badge warn">${icon('shield')} ${esc(tr('safety_q'))}</span>` : ''}</legend>
      ${q.options.map((o, k) => `<label class="option"><input type="radio" name="q${q.index}" value="${k}" required><span>${esc(o)}</span></label>`).join('')}</fieldset>`).join('')}
    <button class="primary block">${esc(tr('submit_exam'))}</button></form></section>`);
}

function viewTrainResult(moduleId, r) {
  shell(`<section class="card exam-result ${r.passed ? 'ok' : 'fail'}">
    ${icon(r.passed ? 'check' : 'warn', 'huge')}<h1>${esc(r.passed ? tr('passed') : tr('failed'))}</h1>
    <p class="score">${r.score} / ${r.total} (${r.percent} %)</p>
    ${!r.safety_ok ? `<div class="banner">${icon('shield')} ${esc(tr('safety_failed'))}</div>` : ''}
    ${r.needs_practical ? `<div class="banner">${icon('shield')} ${esc(tr('needs_practical'))}. ${esc(tr('practical_hint'))}</div>` : ''}
    ${r.certificate ? `<p class="badge ok">${icon('star')} ${esc(tr('st_certified'))} · ${esc(r.certificate)}</p>` : ''}
    <ol class="plain results">${r.results.filter((x) => !x.correct).map((x) => `<li class="bad">${icon('warn')} ${esc(x.q)}${x.safety ? ` <span class="badge warn">${esc(tr('safety_q'))}</span>` : ''}
      <br><small>${esc(tr('your_answer'))}: ${esc(x.given)}</small><br><small>✓ ${esc(tr('right_answer'))}: <b>${esc(x.right)}</b></small>${x.explain ? `<p class="note">${esc(x.explain)}</p>` : ''}</li>`).join('')}</ol>
    <div class="row">${!r.passed ? `<button class="primary" data-action="train-start" data-id="${moduleId}">${esc(tr('repeat'))}</button>` : ''}<a class="secondary" href="#/train">${esc(tr('train_areas'))}</a></div>
  </section>`);
}

async function viewHelp() {
  const __seq = renderSeq;
  const q = S.helpQ || '';
  let res = { results: [] };
  if (q) { try { res = await get(`/api/help?${qs({ q, lang: S.lang })}`); } catch (e) { return render(__seq, errorBox(e)); } }
  const kind = { training: ['school', tr('train_areas')], handbook: ['book', tr('handbook')], guide: ['list', tr('btn_guide')] };
  render(__seq, `<h1 class="page-title">${icon('book')} ${esc(tr('help_title'))}</h1>
    <form data-submit="help" class="form card"><label>${esc(tr('help_title'))}<input name="q" value="${esc(q)}" placeholder="${esc(tr('help_placeholder'))}" required></label>
      <button class="primary">${esc(tr('search'))}</button></form>
    ${q ? (res.results.length ? `<div class="course-list">${res.results.map((r) => `<a class="course" href="${esc(r.link)}">${icon(kind[r.kind][0], 'big')}<div><b>${esc(r.title)}</b><small>${esc(r.snippet)}</small></div><span class="badge">${esc(kind[r.kind][1])}</span></a>`).join('')}</div>`
      : `<p class="note">${esc(tr('no_results'))}</p>`) : ''}`);
}

// --- Timer (Haltezeiten) -------------------------------------------------------------
let timerTick = null, beeped = new Set();
function fmtRemain(sec) {
  const a = Math.abs(sec), m = Math.floor(a / 60), r = a % 60;
  return `${sec < 0 ? '+' : ''}${m}:${String(r).padStart(2, '0')}`;
}
function beep() {
  try { navigator.vibrate?.([300, 150, 300]); const ac = new AudioContext(); const o = ac.createOscillator(); o.frequency.value = 880; o.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.4); } catch { /* ohne Ton */ }
}
async function viewTimer() {
  const __seq = renderSeq;
  let products, data;
  try { [products, data] = await Promise.all([get(`/api/products?${qs({ branch: S.branch, lang: S.lang })}`), get(`/api/timers?${qs({ branch: S.branch, lang: S.lang })}`)]); } catch (e) { return render(__seq, errorBox(e)); }
  const offset = Date.parse(data.now) - Date.now(); // Serverzeit maßgeblich
  render(__seq, `<h1 class="page-title">${icon('history')} ${esc(tr('tab_timer'))}</h1>
    <section class="card"><h2>${esc(tr('running_timers'))}</h2>
      <div class="timers">${data.timers.map((t) => `<div class="timer ${t.state}" data-ends="${esc(t.ends_at)}" data-id="${t.id}" data-kind="${t.kind}">
        <div class="timer-main">${icon(t.product.icon, 'big')}<div><b>${esc(t.product.name)}</b><small>${esc(t.kind === 'hold' ? tr('hold') : tr('cook'))} · ${esc(t.started_by)}</small></div>
        <span class="countdown">${fmtRemain(t.remaining_s)}</span></div>
        <div class="row"><button class="secondary" data-action="timer-end" data-id="${t.id}" data-end="done" ${t.state === 'expired' && t.kind === 'hold' ? 'disabled' : ''}>${icon('check')} ${esc(tr('used'))}</button>
        <button class="danger" data-action="timer-end" data-id="${t.id}" data-end="discarded">${icon('trash')} ${esc(tr('discarded'))}</button></div>
        <p class="expired-label">${icon('warn')} ${esc(tr('expired'))}</p></div>`).join('') || '<p class="note">–</p>'}</div></section>
    <div class="product-grid">${products.filter((p) => p.active).map((p) => `<div class="product ${p.hold_minutes || p.cook_seconds ? '' : 'disabled'}">
      ${icon(p.icon, 'big')}<b>${esc(p.name)}</b>
      ${p.hold_minutes ? `<button class="primary" data-action="timer-start" data-id="${p.id}" data-kind="hold">${esc(tr('start_hold'))} · ${p.hold_minutes} ${esc(tr('min'))}</button>` : ''}
      ${p.cook_seconds ? `<button class="secondary" data-action="timer-start" data-id="${p.id}" data-kind="cook">${esc(tr('start_cook'))} · ${fmtRemain(p.cook_seconds)}</button>` : ''}
      ${!p.hold_minutes && !p.cook_seconds ? `<small class="note">${esc(tr('no_time_set'))}</small>` : ''}
      ${p.value_source ? `<small class="source">${esc(p.value_source)}</small>` : ''}</div>`).join('')}</div>`);
  clearInterval(timerTick);
  const tick = () => {
    if (!location.hash.startsWith('#/timer')) return clearInterval(timerTick);
    document.querySelectorAll('.timer[data-ends]').forEach((el) => {
      const rem = Math.round((Date.parse(el.dataset.ends) - (Date.now() + offset)) / 1000);
      el.querySelector('.countdown').textContent = fmtRemain(rem);
      if (rem <= 0 && !el.classList.contains('expired')) {
        el.classList.add('expired');
        const usedBtn = el.querySelector('[data-end=done]');
        if (usedBtn && el.dataset.kind === 'hold') usedBtn.disabled = true;
        if (!beeped.has(el.dataset.id)) { beeped.add(el.dataset.id); beep(); }
      }
    });
  };
  tick();
  timerTick = setInterval(tick, 1000);
}

// --- Wareneingang ---------------------------------------------------------------------
let scanState = null;
async function viewGoods() {
  const __seq = renderSeq;
  const items = await get('/api/items').catch(() => []);
  const sc = scanState;
  let result = '';
  if (sc) {
    const kindLabel = sc.kind === 'gtin' ? tr('code_gtin') : sc.kind === 'metro_article' ? tr('code_metro') : sc.kind === 'url' ? tr('code_url') : tr('code_unknown');
    result = `<div class="scan-result">
        <p><b>${esc(kindLabel)}</b>${sc.gtin ? ` · GTIN ${esc(sc.gtin)}` : ''}${sc.batch ? ` · ${esc(tr('batch'))} ${esc(sc.batch)}` : ''}${sc.bestBefore ? ` · ${esc(tr('best_before'))} ${esc(sc.bestBefore)}` : ''}</p>
        ${sc.kind === 'url' ? (sc.open_allowed ? `<button class="secondary" data-action="open-link" data-url="${esc(sc.url)}">${icon('link')} ${esc(tr('open_link'))} (${esc(sc.host)})</button>` : `<p class="note">${esc(tr('link_untrusted'))}: ${esc(sc.host || '')}</p>`) : ''}
        ${sc.item ? `<p class="match">${icon('check')} ${esc(sc.item.name)}</p>` : sc.unknown_id ? `<p class="note">${esc(tr('code_unknown'))}</p>` : ''}
      </div>`;
  }
  const sel = sc?.item?.id;
  const needsTemp = sc?.item?.needs_temperature;
  render(__seq, `<h1 class="page-title">${icon('scan')} ${esc(tr('tab_goods'))}</h1>
    <div class="quick-grid">
      <a class="secondary" href="#/daily/early">${icon('sun')} ${esc(tr('daily_inventory'))} ${esc(tr('early_shift'))}</a>
      <a class="secondary" href="#/daily/late">${icon('moon')} ${esc(tr('daily_inventory'))} ${esc(tr('late_shift'))}</a>
      <a class="secondary" href="#/inventory">${icon('box')} ${esc(tr('inventory'))}</a>
      <a class="secondary" href="#/pest">${icon('bug')} ${esc(tr('pest_check'))}</a>
      <a class="secondary" href="#/marinade">${icon('prep')} ${esc(tr('marinade'))}</a></div>
    <section class="card">
      <form data-submit="scan" class="form scan-form">
        <label>${esc(tr('scan_or_type'))}<input name="code" autocomplete="off" inputmode="text" value="${esc(sc?.raw || '')}"></label>
        <div class="row"><button type="button" class="secondary" data-action="camera-scan">${icon('camera')} ${esc(tr('camera_scan'))}</button><button class="primary">${esc(tr('check_code'))}</button></div>
      </form>
      <video id="scanvideo" class="scanvideo" playsinline muted hidden></video>
      ${result}
    </section>
    <section class="card">
      <form data-submit="receipt" class="form">
        <label>${esc(tr('item'))}<select name="item_id" required><option value="">–</option>${items.map((i) => `<option value="${i.id}" data-temp="${i.needs_temperature}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select></label>
        <div class="grid2">
          <label>${esc(tr('quantity'))}<input name="quantity" type="number" step="0.01" min="0.01" required></label>
          <label>${esc(tr('batch'))}<input name="batch" value="${esc(sc?.batch || '')}"></label>
          <label>${esc(tr('best_before'))}<input name="best_before" type="date" value="${esc(sc?.bestBefore || '')}"></label>
          <label>${esc(tr('temperature'))}${needsTemp ? ' *' : ''}<input name="temperature" type="number" step="0.1" ${needsTemp ? 'required' : ''}></label>
        </div>
        <label class="check"><input type="checkbox" name="condition_ok" checked> ${esc(tr('condition_ok'))}</label>
        <label>${esc(tr('reject_reason'))}<input name="reject_reason"></label>
        ${photoField('goods', tr('photo_required'))}
        <div class="row"><button class="danger" name="decision" value="rejected">${esc(tr('reject'))}</button><button class="primary" name="decision" value="accepted">${esc(tr('accept'))}</button></div>
      </form>
    </section>
    <section class="card"><h2>${icon('box')} ${esc(tr('stock'))}</h2><div id="stock">…</div></section>`);
  try {
    const stock = await get(`/api/stock?branch=${S.branch}`);
    const el = document.getElementById('stock');
    if (el) el.innerHTML = stockTable(stock, false);
  } catch { /* Anzeige bleibt */ }
}

function stockTable(stock, manage) {
  return `<table class="tbl"><thead><tr><th>${esc(tr('item'))}</th><th>${esc(tr('stock'))}</th><th>${esc(tr('min_stock'))}</th>${manage ? '<th></th>' : ''}</tr></thead><tbody>
    ${stock.map((s) => `<tr class="${s.below_min ? 'low' : ''}"><td>${esc(s.name)}${s.metro_article_no ? `<br><small>METRO ${esc(s.metro_article_no)}</small>` : ''}</td><td>${s.qty} ${esc(s.unit)}${s.below_min ? ` <span class="badge warn">${esc(tr('reorder'))}</span>` : ''}</td><td>${s.min_qty}</td>
      ${manage ? `<td><form data-submit="count" data-item="${s.id}" class="inline"><input name="counted" type="number" step="0.01" min="0" placeholder="gezählt" aria-label="Gezählt"><button class="small">Inventur</button></form>
        <form data-submit="waste" data-item="${s.id}" class="inline"><input name="quantity" type="number" step="0.01" min="0.01" placeholder="Menge" aria-label="Menge"><input name="note" placeholder="Grund" aria-label="Grund"><button class="small">${esc(tr('waste'))}</button></form></td>` : ''}</tr>`).join('')}</tbody></table>`;
}

async function startCameraScan() {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { S.flash = { type: 'error', text: tr('scanner_unsupported') }; return route(); }
  const video = document.getElementById('scanvideo');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) { return showError(e); }
  video.hidden = false; video.srcObject = stream; await video.play();
  // eslint-disable-next-line no-undef
  const det = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'data_matrix'] });
  const stop = () => { stream.getTracks().forEach((tk) => tk.stop()); video.hidden = true; };
  const loop = async () => {
    if (video.hidden) return;
    try {
      const codes = await det.detect(video);
      if (codes.length) { stop(); return doScan(codes[0].rawValue); }
    } catch { /* weiter versuchen */ }
    requestAnimationFrame(loop);
  };
  loop();
  setTimeout(stop, 30000);
}

async function doScan(code) {
  // Lokale Vorprüfung (gleiche Logik wie Server) für sofortige Anzeige; der Server entscheidet verbindlich.
  void classifyCode(code, S.config.trusted_hosts);
  try { scanState = await post('/api/goods/scan', { branch: S.branch, code }); route(); } catch (e) { showError(e); }
}

// --- Tagesinventur (Früh/Spät mit Frist) ---------------------------------------------------
async function viewDaily(shift) {
  const __seq = renderSeq;
  const sh = shift === 'late' ? 'late' : 'early';
  let d;
  try { d = await get(`/api/daily?${qs({ branch: S.branch, shift: sh })}`); } catch (e) { return render(__seq, errorBox(e)); }
  const done = ['on_time', 'late_done'].includes(d.state);
  const badge = { open: 'warn', on_time: 'ok', late_done: 'change', missed: 'change' }[d.state];
  const filled = d.items.filter((i) => i.counted != null).length;
  let cat = '';
  render(__seq, `<h1 class="page-title">${icon('box')} ${esc(tr('daily_inventory'))}</h1>
    <div class="segs two"><a class="seg ${sh === 'early' ? 'on' : ''}" href="#/daily/early">${icon('sun')}<span>${esc(tr('early_shift'))}</span></a><a class="seg ${sh === 'late' ? 'on' : ''}" href="#/daily/late">${icon('moon')}<span>${esc(tr('late_shift'))}</span></a></div>
    <section class="card inv-head state-${d.state === 'missed' ? 'overdue' : d.state}"><b>${esc(new Date(d.date).toLocaleDateString('de-DE'))} · ${esc(tr('deadline'))} ${esc(d.deadline)} Uhr</b>
      <span class="badge ${badge}">${esc(tr('state_' + d.state))}${d.by ? ` · ${esc(d.by)} ${fmtTime(d.submitted_at)}` : ''}</span>
      <progress max="${d.items.length}" value="${filled}"></progress><small>${filled}/${d.items.length} · ${esc(tr('daily_rule'))}</small></section>
    <form data-submit="daily" data-shift="${sh}" class="form daily-form">
      ${d.items.map((i) => { const head = i.category !== cat ? `<h3>${esc((cat = i.category))}</h3>` : '';
        return `${head}<div class="daily-row ${i.meat ? 'meat' : ''}"><label class="daily-name">${esc(i.name)} <small>(${esc(i.unit)})</small>
          <input name="c${i.item_id}" type="number" inputmode="decimal" step="0.01" min="0" value="${i.counted ?? ''}" ${done ? 'disabled' : ''}></label>
          ${i.meat ? `<label>${esc(tr('marinated'))}<input name="m${i.item_id}" type="number" inputmode="decimal" step="0.01" min="0" value="${i.marinated ?? ''}" ${done ? 'disabled' : ''}></label>` : ''}
          <label>${esc(tr('unusable'))}<input name="u${i.item_id}" type="number" inputmode="decimal" step="0.01" min="0" value="${i.unusable ?? ''}" ${done ? 'disabled' : ''}></label></div>`; }).join('')}
      ${done ? '' : `<div class="row wrap"><button class="secondary" name="act" value="save">${esc(tr('save_draft'))}</button><button class="primary" name="act" value="submit">${icon('check')} ${esc(tr('submit_daily'))}</button></div>`}
    </form>
    <a class="secondary block" href="#/problem/">${icon('warn')} ${esc(tr('btn_problem'))}</a>`);
}

// --- Schädlingskontrolle ------------------------------------------------------------------
async function viewPest() {
  const __seq = renderSeq;
  let d;
  try { d = await get(`/api/pest?branch=${S.branch}`); } catch (e) { return render(__seq, errorBox(e)); }
  const list = (arr) => `<ul class="bullets">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  render(__seq, `<h1 class="page-title">${icon('bug')} ${esc(tr('pest_check'))}</h1>
    <section class="card danger-card"><h2>${icon('warn')} ${esc(tr('pest_if_found'))}</h2><ol class="numbered">${d.guide.found.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>
    <details class="card"><summary>${esc(tr('pest_watch'))}</summary>${list(d.guide.watch)}</details>
    <details class="card"><summary>${esc(tr('pest_prevent'))}</summary>${list(d.guide.prevent)}</details>
    <form data-submit="pest" class="form card"><h2>${icon('list')} ${esc(tr('pest_check'))}</h2>
      ${d.areas.map((a, k) => `<fieldset class="pest-area"><legend>${esc(a)}</legend>
        <div class="yn"><label class="yes"><input type="radio" name="f${k}" value="0" required> ✓ nichts gefunden</label><label class="no"><input type="radio" name="f${k}" value="1"> ✗ ${esc(tr('finding'))}</label></div>
        <div class="grid2"><label>Was gefunden?<input name="n${k}"></label><label>${esc(tr('measure'))}<input name="m${k}"></label></div>
        <label class="check"><input type="checkbox" name="d${k}"> ${esc(tr('done_short'))}</label></fieldset>`).join('')}
      <label class="check"><input type="checkbox" name="exterminator"> ${esc(tr('exterminator'))}</label>
      <label>${esc(tr('remarks'))}<textarea name="remarks" rows="2"></textarea></label>
      ${photoField('problem', tr('take_photo') + ' (Pflicht bei Befall)')}
      <button class="primary block">${icon('check')} ${esc(tr('save_check'))}</button></form>
    <h2>${icon('history')} Verlauf</h2><ul class="plain">${d.history.map((h) => `<li>${fmtTime(h.created_at)} · ${esc(h.by)} · ${h.infestation ? `<b class="bad-text">Befall: ${esc(h.areas.filter((a) => a.finding).map((a) => a.area).join(', '))}</b>` : 'kein Befall'}${h.exterminator_needed ? ' · Schädlingsbekämpfer erforderlich' : ''}</li>`).join('') || '<li>–</li>'}</ul>`);
}

// --- Passwort ändern (erzwungen bei Startpasswort) ----------------------------------------
function viewPassword() {
  shell(`<section class="card"><h1>${icon('lock')} ${esc(tr('set_password'))}</h1><p class="banner">${esc(tr('must_change'))}</p>
    <form data-submit="change-password" class="form"><label>${esc(tr('old_password'))}<input name="old_password" type="password" autocomplete="current-password" required></label>
      <label>${esc(tr('new_password'))}<input name="new_password" type="password" autocomplete="new-password" minlength="10" required></label>
      <label>${esc(tr('repeat_password'))}<input name="new_password2" type="password" autocomplete="new-password" minlength="10" required></label>
      <button class="primary block">${esc(tr('set_password'))}</button></form>
    <button class="secondary" data-action="logout">${esc(tr('logout'))}</button></section>`, { tabs: false });
}

// --- Willkommen & Nachweise --------------------------------------------------------------
async function viewWelcome() {
  const __seq = renderSeq;
  let w;
  try { w = await get(`/api/welcome?branch=${S.branch}`); } catch (e) { return render(__seq, errorBox(e)); }
  const stBadge = (st) => `<span class="badge ${st.state === 'approved' ? 'ok' : st.state === 'pending' ? 'warn' : 'change'}">${esc(tr('st_' + st.state))}</span>`;
  const item = (label, st, link) => `<li class="welcome-item ${st.state}"><div><b>${esc(label)}</b> ${stBadge(st)}${st.review_note ? `<br><small class="bad-text">${esc(st.review_note)}</small>` : ''}
    ${st.state !== 'approved' && link ? `<p class="note">${esc(link.text)}${link.url ? ` <a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(tr('official_link'))} →</a>` : ''}</p>` : ''}</div></li>`;
  render(__seq, `<h1 class="page-title">${icon('user')} ${esc(tr('welcome'))}, ${esc(w.name)}</h1>
    <section class="card"><h2>${esc(tr('welcome_steps'))}</h2><ul class="plain welcome-list">
      ${item(tr('cert_ifsg43'), w.ifsg43, w.links.ifsg43)}${item(tr('cert_metro'), w.metro_hygiene, w.links.metro_hygiene)}
      <li class="welcome-item"><div><b>${esc(tr('handbook'))}</b> <span class="badge ${w.handbook_confirmed ? 'ok' : 'warn'}">${esc(w.handbook_confirmed ? tr('st_approved') : tr('st_missing'))}</span> <a href="#/handbook">→</a></div></li>
      <li class="welcome-item"><div><b>${esc(tr('open_trainings'))}</b> <span class="badge ${w.open_trainings ? 'warn' : 'ok'}">${w.open_trainings}</span> <a href="#/learn">→</a></div></li></ul>
      <p class="note">METRO-Hygieneschulung ersetzt die Belehrung nach §43 IfSG nicht.</p></section>
    <form data-submit="certificate" class="form card"><h2>${icon('camera')} ${esc(tr('cert_upload'))}</h2>
      <label>Art<select name="type" required><option value="ifsg43">${esc(tr('cert_ifsg43'))}</option><option value="metro_hygiene">${esc(tr('cert_metro'))}</option><option value="other">${esc(tr('cert_other'))}</option></select></label>
      <div class="grid2"><label>${esc(tr('issued_on'))}<input name="issued_on" type="date" required></label><label>${esc(tr('valid_until_opt'))}<input name="valid_until" type="date"></label></div>
      ${photoField('certificate', tr('cert_upload') + ' (Foto/PDF)')}
      <button class="primary block">${esc(tr('send'))}</button></form>
    <h2>${icon('history')} Meine Nachweise</h2><ul class="plain">${w.certificates.map((c) => `<li>${esc(c.type_label)} · ${esc(c.issued_on || '')} · ${esc(tr('st_' + c.status))}${c.review_note ? ' – ' + esc(c.review_note) : ''}${c.media_id ? ` · <a href="/api/media/${c.media_id}" target="_blank" rel="noopener">ansehen</a>` : ''}</li>`).join('') || '<li>–</li>'}</ul>`);
}

// --- Mehr ---------------------------------------------------------------------------------
function viewMore() {
  const __seq = renderSeq;
  const b = (href, ic, label) => `<a class="big-btn" href="${href}">${icon(ic)}<span>${esc(label)}</span></a>`;
  render(__seq, `<h1 class="page-title">${icon('dash')} ${esc(tr('tab_more'))}</h1><div class="persona-grid more-grid">
    ${b('#/goods', 'scan', tr('tab_goods'))}${b('#/daily/early', 'sun', tr('daily_inventory') + ' ' + tr('early_shift'))}${b('#/daily/late', 'moon', tr('daily_inventory') + ' ' + tr('late_shift'))}
    ${b('#/inventory', 'box', tr('inventory'))}${b('#/oil', 'oil', tr('tab_oil'))}${b('#/marinade', 'prep', tr('marinade'))}${b('#/pest', 'bug', tr('pest_check'))}${b('#/handbook', 'book', tr('handbook'))}
    ${b('#/controls', 'box', tr('control_lists'))}${b('#/help', 'book', tr('help_title'))}${b('#/train', 'school', tr('train_areas'))}${b('#/problem/', 'warn', tr('btn_problem'))}</div>`);
}

// --- Reinigungsplan ------------------------------------------------------------------------
async function viewCleaning() {
  const __seq = renderSeq;
  let d;
  try { d = await get(`/api/cleaning?${qs({ branch: S.branch, lang: S.lang })}`); } catch (e) { return render(__seq, errorBox(e)); }
  const badge = { open: '', in_progress: 'warn', done: 'ok', overdue: 'change', rework: 'change', problem: 'change' };
  const row = (t) => `<li class="clean-row st-${t.status}"><div class="clean-main">${icon(t.icon, 'big')}<div><b>${esc(t.title)}</b>
      <small>${esc(tr('shift_' + t.shift))}${t.assigned ? ` · ${esc(tr('assigned_to'))}: ${esc(t.assigned)}` : ''}${t.cleaning_agent ? ` · ${esc(t.cleaning_agent)}` : ''}</small>
      ${t.status === 'done' ? `<small>${icon('check')} ${esc(t.completed_by || '')} ${fmtTime(t.completed_at)}</small>` : ''}${t.status === 'in_progress' ? `<small>${esc(t.started_by || '')} · ${fmtTime(t.started_at)}</small>` : ''}
      ${t.status === 'rework' && t.note ? `<small class="bad-text">${esc(t.note)}</small>` : ''}</div>
      <span class="badge ${badge[t.status]}">${esc(tr('status_' + t.status))}</span></div>
      ${['open', 'overdue', 'rework', 'in_progress'].includes(t.status) ? `<div class="row">${t.status !== 'in_progress' ? `<button class="small" data-action="task-start" data-id="${t.id}">${esc(tr('start_task'))}</button>` : ''}<a class="small primary" href="#/task/${t.id}">${esc(tr('do_task'))}</a></div>` : ''}</li>`;
  const groups = ['daily', 'weekly', 'monthly'].map((f) => [f, d.tasks.filter((t) => (t.frequency === f) || (f === 'daily' && !['weekly', 'monthly'].includes(t.frequency)))]);
  const openCount = d.tasks.filter((t) => t.status !== 'done').length;
  render(__seq, `<h1 class="page-title">${icon('spray')} ${esc(tr('tab_cleaning'))}</h1>
    <p class="note">${d.tasks.length - openCount}/${d.tasks.length} ${esc(tr('status_done'))} · ${d.tasks.filter((t) => t.status === 'overdue').length} ${esc(tr('status_overdue'))}</p>
    ${groups.filter(([, arr]) => arr.length).map(([f, arr]) => `<h2>${esc(tr(f))}</h2><ul class="clean-list">${arr.sort((a, b) => ['overdue', 'rework', 'in_progress', 'open', 'problem', 'done'].indexOf(a.status) - ['overdue', 'rework', 'in_progress', 'open', 'problem', 'done'].indexOf(b.status)).map(row).join('')}</ul>`).join('')}
    <h2>${icon('check')} ${esc(tr('after_use'))}</h2>
    <div class="event-grid">${d.event_areas.map((a) => `<button class="secondary" data-action="clean-log" data-area="${esc(a.area)}">${esc(a.area)}<small>${a.last ? `${esc(a.last.by)} · ${fmtTime(a.last.created_at)}` : '–'}</small></button>`).join('')}</div>`);
}

async function viewTask(id) {
  const __seq = renderSeq;
  let n;
  try { n = await get(`/api/tasks/${id}?lang=${S.lang}`); } catch (e) { return render(__seq, errorBox(e)); }
  S.current = n;
  if (!['open', 'rework'].includes(n.status)) return render(__seq, `<section class="card center">${icon('check', 'huge ok')}<h2>${esc(n.title)}</h2><p>${esc(tr('status_done'))} · ${esc(n.completed_by || '')} ${fmtTime(n.completed_at)}</p></section><button class="secondary block" data-action="back">${esc(tr('back'))}</button>`);
  render(__seq, `${taskCard(n)}<button class="secondary block" data-action="back">${esc(tr('back'))}</button>`);
}

// --- Marinaden-Protokoll -----------------------------------------------------------------
let marinadeSel = {}, lastBatch = null;
function batchLabel(b) {
  return `<div class="label-card"><b>${esc(b.batch_code)}</b><span>${esc(b.marinade)}</span><span>${esc(b.meat)} · ${b.meat_kg} kg</span>
    <span>${fmtTime(b.created_at)} · ${esc(b.by)}</span>${b.use_by ? `<span><b>${esc(tr('use_by'))} ${fmtTime(b.use_by)}</b></span>` : ''}${b.allergens ? `<span>${esc(tr('allergens'))}: ${esc(b.allergens)}</span>` : ''}</div>`;
}
async function viewMarinade() {
  const __seq = renderSeq;
  let d;
  try { d = await get(`/api/marinades?branch=${S.branch}`); } catch (e) { return render(__seq, errorBox(e)); }
  const r = d.recipes.find((x) => x.id === Number(marinadeSel.recipe)) || d.recipes[0];
  const kg = Number(marinadeSel.kg) || 0;
  const tgt = (ing) => Math.round(ing.per_kg * kg * 1000) / 1000;
  render(__seq, `<h1 class="page-title">${icon('prep')} ${esc(tr('marinade'))}</h1>
    ${lastBatch ? `<section class="card ok-card"><h2>${icon('check')} ${esc(tr('label'))}</h2><p class="note">Diese Angaben auf den Behälter schreiben bzw. Etikett drucken.</p>${batchLabel(lastBatch)}<button class="secondary" data-action="print">Drucken</button></section>` : ''}
    ${!d.recipes.length ? '<section class="card">Noch keine Rezeptur hinterlegt. Der Betreiber legt Rezepturen unter Leitung → Rezepturen an.</section>' : `
    <form data-submit="batch" class="form card">
      <div class="banner">${icon('book')} ${esc(tr('recipe_fixed'))}</div>
      <div class="grid2"><label>${esc(tr('recipe'))}<select name="marinade_id" data-change="marinade-recipe">${d.recipes.map((x) => `<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${esc(x.name)} (v${x.version})</option>`).join('')}</select></label>
        <label>${esc(tr('meat_type'))}<select name="meat_item_id" required>${d.meat_items.map((m) => `<option value="${m.id}" ${m.id === Number(marinadeSel.meat) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        <label>${esc(tr('meat_kg'))}<input name="meat_kg" type="number" inputmode="decimal" step="0.01" min="0.01" value="${kg || ''}" data-change="marinade-kg" required></label></div>
      ${r.allergens ? `<p><b>${esc(tr('allergens'))}:</b> ${esc(r.allergens)}</p>` : ''}
      ${kg ? `<table class="tbl"><thead><tr><th>Zutat</th><th>${esc(tr('target'))}</th><th>${esc(tr('weighed'))}</th></tr></thead><tbody>
        ${r.ingredients.map((ing, i) => `<tr><td>${esc(ing.name)}</td><td><b>${tgt(ing)} ${esc(ing.unit)}</b></td><td><input name="a${i}" type="number" inputmode="decimal" step="0.1" min="0" required aria-label="${esc(ing.name)}"> ${esc(ing.unit)}</td></tr>`).join('')}</tbody></table>
        <p class="note">${r.tolerance_percent != null ? `Erlaubte Abweichung: ${r.tolerance_percent} %.` : 'Abweichungen werden der Leitung gemeldet.'} ${r.use_within_hours ? `Verwendbar ${r.use_within_hours} Std. (${esc(r.use_source)}).` : ''}</p>
        <label>Notiz<input name="note"></label><button class="primary block">${icon('check')} ${esc(tr('create_batch'))}</button>` : '<p class="note">Erst Fleischmenge eingeben – dann werden die Zutatenmengen berechnet.</p>'}
    </form>`}
    <h2>${icon('box')} ${esc(tr('active_batches'))}</h2>
    ${d.active.map((b) => `<section class="card batch ${b.expired ? 'expired-batch' : ''}">${batchLabel(b)}${b.expired ? `<p class="bad-text"><b>${icon('warn')} Frist abgelaufen – entsorgen</b></p>` : ''}
      <p>${esc(tr('rest_kg'))}: <b>${b.remaining_kg ?? b.meat_kg}</b>${b.deviations ? ` · <span class="badge warn">${b.deviations} Abweichung(en)</span>` : ''}</p>
      <form data-submit="batch-rest" data-id="${b.id}" class="inline">${!b.expired ? `<input name="remaining_kg" type="number" step="0.01" min="0" max="${b.meat_kg}" placeholder="${esc(tr('rest_kg'))}" aria-label="${esc(tr('rest_kg'))}"><button class="small" name="act" value="rest">Rest speichern</button>` : ''}
        <input name="reason" placeholder="Grund" aria-label="Grund"><button class="small danger" name="act" value="discard">${esc(tr('discard'))}</button></form></section>`).join('') || '<p class="note">–</p>'}
    <details><summary>${icon('history')} Verlauf</summary><ul class="plain">${d.recent.map((b) => `<li>${esc(b.batch_code)} · ${esc(b.marinade)} · ${esc(b.meat)} ${b.meat_kg} kg · ${b.status === 'used' ? 'aufgebraucht' : 'entsorgt: ' + esc(b.discard_reason || '')}</li>`).join('') || '<li>–</li>'}</ul></details>`);
}

// --- Mitarbeiter-Handbuch ---------------------------------------------------------------
async function viewHandbook() {
  const __seq = renderSeq;
  let h;
  try { h = await get(`/api/handbook?branch=${S.branch}`); } catch (e) { return render(__seq, errorBox(e)); }
  const items = (arr) => `<ul class="checks">${arr.map((x) => `<li>${icon('check')} ${esc(x)}</li>`).join('')}</ul>`;
  const c = h.confirmation;
  render(__seq, `<h1 class="page-title">${icon('book')} ${esc(tr('handbook'))}</h1>
    <p class="note">Verbindliche Arbeits-, Hygiene- und Kontrollvorgaben · Version ${h.version}</p>
    ${S.lang !== 'de' ? `<div class="banner">${esc(tr('translation_unreviewed'))}</div>` : ''}
    ${h.chapters.map((ch) => `<details class="card chapter"><summary>${esc(ch.title)}</summary>${ch.intro ? `<p>${esc(ch.intro)}</p>` : ''}
      ${ch.items ? items(ch.items) : ''}${(ch.groups || []).map((g) => `<h3>${esc(g.title)}</h3>${items(g.items)}`).join('')}
      ${ch.steps ? `<ol class="numbered">${ch.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}${ch.rule ? `<p class="banner">${esc(ch.rule)}</p>` : ''}</details>`).join('')}
    <section class="card"><h2>${icon('shield')} 13. ${esc(tr('onboarding'))}</h2>
      ${!c ? `<p class="note">${esc(tr('onboarding_waiting'))}</p>` : `<p>Eingewiesen durch <b>${esc(c.trainer)}</b> am ${fmtTime(c.trainer_confirmed_at)}:</p>${items(c.areas)}
        <p>${esc(h.statement)}</p>
        ${c.employee_confirmed_at ? `<p class="banner ok">${icon('check')} Bestätigt am ${fmtTime(c.employee_confirmed_at)}</p>` : `<button class="primary block" data-action="onboarding-confirm">${icon('check')} ${esc(tr('confirm_onboarding'))}</button>`}`}</section>`);
}

// --- Wöchentliche Inventur --------------------------------------------------------------
async function viewInventory() {
  const __seq = renderSeq;
  let d;
  try { d = await get(`/api/inventory?branch=${S.branch}`); } catch (e) { return render(__seq, errorBox(e)); }
  const stateLabel = { due: tr('inventory_due'), overdue: tr('inventory_overdue'), upcoming: `${tr('inventory_upcoming')} ${new Date(d.due_date).toLocaleDateString('de-DE')}`, done: tr('inventory_done') }[d.state];
  const done = d.state === 'done';
  const canFinish = isShiftLead();
  const counted = d.items.filter((i) => i.counted != null).length;
  render(__seq, `<h1 class="page-title">${icon('box')} ${esc(tr('inventory'))}</h1>
    <section class="card inv-head state-${d.state}"><b>${esc(d.week)}</b> <span class="badge ${d.state === 'done' ? 'ok' : d.state === 'overdue' ? 'change' : 'warn'}">${esc(stateLabel)}</span>
      <progress max="${d.items.length}" value="${counted}"></progress><small>${counted}/${d.items.length} ${esc(tr('counted'))}</small></section>
    <form data-submit="inventory" class="form"><table class="tbl inv"><thead><tr><th>${esc(tr('item'))}</th><th>${esc(tr('expected'))}</th><th>${esc(tr('counted'))}</th></tr></thead><tbody>
      ${d.items.map((i) => `<tr class="${i.counted != null && i.expected != null && Math.abs(i.counted - i.expected) > 0.0001 ? 'low' : ''}"><td>${esc(i.name)}<br><small>${esc(i.unit)}</small></td><td>${i.expected ?? '–'}</td>
        <td><input name="c${i.item_id}" type="number" inputmode="decimal" step="0.01" min="0" value="${i.counted ?? ''}" ${done ? 'disabled' : ''} aria-label="${esc(i.name)}"></td></tr>`).join('')}</tbody></table>
      ${done ? '' : `<div class="row wrap"><button class="secondary" name="act" value="save">${esc(tr('save_draft'))}</button>${canFinish ? `<button class="primary" name="act" value="submit">${icon('check')} ${esc(tr('finish_inventory'))}</button>` : ''}</div>`}
    </form>
    ${isManager() ? `<form data-submit="inventory-weekday" class="form inline card"><label>Inventur-Tag<select name="weekday">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w, k) => `<option value="${k + 1}" ${k + 1 === d.weekday ? 'selected' : ''}>${w}</option>`).join('')}</select></label><button class="small primary">Speichern</button></form>` : ''}
    <h2>${icon('history')} Verlauf</h2><ul class="plain">${d.history.map((h) => `<li>${esc(h.week)} · ${h.status === 'submitted' ? `${esc(tr('inventory_done'))} ${fmtTime(h.submitted_at)} · ${esc(h.by || '')} · ${h.diff_items} Abweichungen` : 'begonnen'}</li>`).join('') || '<li>–</li>'}</ul>`);
}

// --- Ölmanager ------------------------------------------------------------------------
async function viewOil() {
  const __seq = renderSeq;
  let fryers;
  try { fryers = await get(`/api/oil?branch=${S.branch}`); } catch (e) { return render(__seq, errorBox(e)); }
  const stateLabel = (f) => ({ ok: tr('oil_ok'), warn: tr('oil_warn'), change: tr('oil_change_now'), unknown: tr('oil_unknown') }[f.state]);
  const reason = (f) => ({ no_limit: tr('oil_no_limit'), no_measurement: tr('oil_no_measure'), not_measured_today: tr('oil_not_today') }[f.reason] || '');
  const changeInfo = (f) => f.next_change_due ? `${esc(tr('next_change'))}: <b>${new Date(f.next_change_due).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</b>${f.change_state === 'overdue' ? ` <span class="badge change">${esc(tr('overdue'))}</span>` : f.change_state === 'due' ? ` <span class="badge warn">${esc(tr('inventory_due'))}</span>` : ''}` : f.change_interval_days ? `${esc(tr('next_change'))}: –` : '';
  const evLabel = { tpm: 'Prüfung', filter: tr('oil_filter'), topup: tr('oil_topup'), change: tr('oil_change') };
  render(__seq, `<h1 class="page-title">${icon('oil')} ${esc(tr('tab_oil'))}</h1>
    ${fryers.map((f) => `<section class="card fryer state-${f.state}">
      <h2>${icon('fryer')} ${esc(f.name)} <span class="badge ${f.state}">${esc(stateLabel(f))}</span></h2>
      ${f.blocked ? `<div class="banner danger">${icon('lock')} ${esc(tr('blocked_fryer'))}<br><small>${esc(f.blocked_reason || '')}</small></div>` : ''}
      <p class="meta">${esc(f.manufacturer || '')} ${esc(f.model || '')}${f.model_verified ? '' : ' · Modell nicht verifiziert'} · ${esc(f.oil_product || '')}</p>
      <p>${f.last_tpm != null ? `TPM ${f.last_tpm} %` : ''}${f.last_temperature != null ? ` · ${f.last_temperature} °C` : ''}${f.last_measured_at ? ` · ${fmtTime(f.last_measured_at)}` : ''} ${f.tpm_limit != null ? `· Grenzwert ${f.tpm_limit} % (${esc(f.limit_source || '')})` : ''}</p>
      <p>${changeInfo(f)}</p>
      ${reason(f) && !f.blocked ? `<p class="note">${esc(reason(f))}</p>` : ''}
      ${!f.blocked ? `<form data-submit="oil" data-id="${f.id}" class="form"><h3>${esc(tr('oil_check'))}</h3>
        <div class="grid2"><label>TPM %<input name="tpm" type="number" inputmode="decimal" step="0.5" min="0" max="100"></label><label>${esc(tr('temperature_c'))}<input name="temperature" type="number" inputmode="decimal" step="1"></label></div>
        <div class="yn"><label class="yes"><input type="radio" name="quality_ok" value="1"> ✓ ${esc(tr('quality_ok'))}</label><label class="no"><input type="radio" name="quality_ok" value="0"> ✗ ${esc(tr('quality_bad'))}</label></div>
        ${photoField('oil-' + f.id, tr('photo_required'))}
        <div class="row wrap"><button class="primary" name="type" value="tpm">${icon('check')} ${esc(tr('oil_check'))}</button><button class="secondary" name="type" value="filter">${esc(tr('oil_filter'))}</button><button class="secondary" name="type" value="topup">${esc(tr('oil_topup'))}</button></div>
      </form>` : ''}
      <form data-submit="oil-change" data-id="${f.id}" class="form change-form"><h3>${icon('oil')} ${esc(tr('oil_change'))}</h3>
        <div class="grid2">${f.blocked ? `<p>${esc(tr('oil_reason'))}: <b>${esc(tr('reason_quality'))}</b></p>` : `<label>${esc(tr('oil_reason'))}<select name="reason" required><option value="">–</option><option value="planned">${esc(tr('reason_planned'))}</option><option value="early">${esc(tr('reason_early'))}</option><option value="quality">${esc(tr('reason_quality'))}</option></select></label>`}
          <label>${esc(tr('liters'))}<input name="quantity_l" type="number" inputmode="decimal" step="0.5" min="0.5"></label>
          <label>TPM % (neu)<input name="tpm" type="number" step="0.5" min="0" max="100"></label><label>${esc(tr('temperature_c'))}<input name="temperature" type="number" step="1"></label></div>
        ${photoField('oilchange-' + f.id, tr('take_photo') + ' (optional)')}
        <button class="${f.blocked ? 'primary' : 'secondary'} block">${icon('check')} ${esc(tr('oil_change'))}</button></form>
      <details><summary>${icon('history')} Verlauf</summary><ul class="plain">${f.history.map((h) => `<li>${fmtTime(h.at)} · <b>${esc(evLabel[h.type])}</b>${h.reason ? ` (${esc(tr('reason_' + h.reason))})` : ''}${h.tpm != null ? ` · TPM ${h.tpm} %` : ''}${h.temperature != null ? ` · ${h.temperature} °C` : ''}${h.quality_ok === 0 ? ' · <b class="bad-text">unzulässig</b>' : h.quality_ok === 1 ? ' · zulässig' : ''}${h.quantity_l ? ` · ${h.quantity_l} L` : ''} · ${esc(h.by)}${h.source === 'test' ? ' · <span class="badge warn">TESTDATEN</span>' : h.source === 'import' ? ' · Import' : ''}</li>`).join('') || '<li>–</li>'}</ul></details>
    </section>`).join('') || '<p>–</p>'}`);
}

// --- Leitung ----------------------------------------------------------------------------
function manageNav(active) {
  const items = [['dashboard', 'dash', 'Übersicht'], ['positions', 'store', 'Positionsplan'], ['observe', 'eye', 'Stationscheck'], ['stations', 'star', 'Stationen & Stufen'],
    ['staff', 'lock', 'Mitarbeiter & Zugänge'], ['certs', 'shield', 'Nachweise (§43/METRO)'], ['staffing', 'user', 'Besetzung & Verteilung'], ['week', 'report', 'Wochenbericht'], ['daily', 'box', 'Tagesinventur'], ['onboarding', 'shield', 'Einarbeitung'], ['problems', 'warn', 'Probleme'], ['report', 'report', 'Schichtbericht'], ['templates', 'list', 'Aufgaben-Vorlagen'], ['products', 'history', 'Haltezeiten'],
    ['controls', 'box', 'Kontrolllisten'], ['academy', 'school', 'Schulungsbereiche'], ['training', 'school', 'Schulung & Freigaben'], ['stock', 'box', 'Bestand & Codes'], ['oil', 'oil', 'Öl-Grenzwerte'], ['audit', 'history', 'Protokoll']];
  if (S.me.is_admin) items.push(['recipes', 'prep', 'Rezepturen (Marinaden)'], ['sops', 'book', 'Anleitungen (SOP)'], ['users', 'user', 'Benutzer & Filialen']);
  const allowed = { dashboard: true, staffing: isShiftLead(), week: isShiftLead(), daily: isShiftLead(), onboarding: isTrainer(), positions: isShiftLead(), observe: isTrainer(), stations: isShiftLead() || isTrainer(), training: isTrainer() || isManager() };
  const visible = items.filter(([k]) => isManager() || allowed[k]);
  return `<nav class="subnav">${visible.map(([k, ic, l]) => `<a href="#/manage/${k}" class="${active === k ? 'on' : ''}">${icon(ic)} ${l}</a>`).join('')}</nav>`;
}

async function viewManage(sub = 'dashboard', arg) {
  const __seq = renderSeq;
  try {
    const fn = { dashboard: mDashboard, controls: mControls, academy: mAcademy, staff: mStaff, certs: mCerts, staffing: mStaffing, week: mWeek, recipes: mRecipes, daily: mDaily, onboarding: mOnboarding, positions: mPositions, observe: mObserve, stations: mStations, products: mProducts, problems: mProblems, report: mReport, templates: mTemplates, training: mTraining, stock: mStock, oil: mOil, audit: mAudit, sops: mSops, users: mUsers }[sub] || mDashboard;
    const html = await fn(arg);
    render(__seq, `${manageNav(sub)}<div class="manage">${html}</div>`);
  } catch (e) { render(__seq, `${manageNav(sub)}${errorBox(e)}`); }
}

const SHIFT_DE = { open: 'Öffnung', run: 'Betrieb', close: 'Schließung' };
const STATUS_DE = { open: 'offen', done: 'erledigt', problem: 'Problem', rework: 'Nacharbeit', approved: 'freigegeben' };
async function mDashboard() {
  const list = await get(`/api/dashboard?branch=${S.branch}`);
  return list.map((d) => `<h1>${icon('store')} ${esc(d.branch.name)} · ${esc(d.date)}</h1>
    <div class="stats">
      ${['open', 'run', 'close'].map((s) => { const x = d.shifts[s] || { open: 0, done: 0, problem: 0 }; return `<article class="stat"><small>${SHIFT_DE[s]}</small><b>${x.done}/${x.open + x.done + x.problem}</b><span>${x.open} offen · ${x.problem} Problem</span></article>`; }).join('')}
      <article class="stat ${d.overdue ? 'bad' : ''}"><small>Überfällig</small><b>${d.overdue}</b><span>aus Vortagen</span></article>
      <article class="stat ${d.open_problems ? 'bad' : ''}"><small>Offene Probleme</small><b>${d.open_problems}</b><span><a href="#/manage/problems">ansehen →</a></span></article>
      <article class="stat"><small>Fotos heute</small><b>${d.photos_today}</b><span>Nachweise</span></article>
      <article class="stat"><small>Schulung</small><b>${d.training.qualified}/${d.training.learners * d.training.courses}</b><span>Qualifikationen</span></article>
      <article class="stat ${['overdue', 'due'].includes(d.inventory.state) ? 'bad' : ''}"><small>Inventur ${esc(d.inventory.week)}</small><b>${esc({ done: 'erledigt', due: 'heute', overdue: 'überfällig', upcoming: 'offen' }[d.inventory.state])}</b><span><a href="#/inventory">öffnen →</a> · fällig ${new Date(d.inventory.due_date).toLocaleDateString('de-DE')}</span></article>
      ${['early', 'late'].map((k) => `<article class="stat ${['missed', 'late_done'].includes(d.daily[k].state) ? 'bad' : ''}"><small>Tagesinventur ${k === 'early' ? 'Früh' : 'Spät'} (bis ${esc(d.daily[k].deadline)})</small><b>${esc(DSTATE[d.daily[k].state][0])}</b><span>${d.daily[k].by ? esc(d.daily[k].by) : '<a href="#/manage/daily">ansehen →</a>'}</span></article>`).join('')}
      <article class="stat ${d.certificates.missing_ifsg43 ? 'bad' : ''}"><small>§43-Nachweis fehlt</small><b>${d.certificates.missing_ifsg43}</b><span>${d.certificates.pending} zur Prüfung · <a href="#/manage/certs">ansehen →</a></span></article>
      <article class="stat ${d.marinade_batches.expired ? 'bad' : ''}"><small>Marinaden-Chargen offen</small><b>${d.marinade_batches.n}</b><span>${d.marinade_batches.expired || 0} Frist abgelaufen · <a href="#/marinade">ansehen →</a></span></article>
      <article class="stat ${d.last_pest_check?.infestation ? 'bad' : ''}"><small>Schädlingskontrolle</small><b>${d.last_pest_check ? (d.last_pest_check.infestation ? 'Befall!' : 'ohne Befund') : '–'}</b><span>${d.last_pest_check ? fmtTime(d.last_pest_check.created_at) : 'noch keine'}</span></article>
      <article class="stat ${d.open_trainings.length ? 'bad' : ''}"><small>Offene Pflichtschulungen</small><b>${d.open_trainings.length}</b><span><a href="#/manage/training">ansehen →</a></span></article>
      <article class="stat ${d.timers_expired ? 'bad' : ''}"><small>Timer</small><b>${d.timers_running}</b><span>${d.timers_expired} abgelaufen, nicht entsorgt</span></article>
      <article class="stat ${d.position_plans_today.length < 3 ? 'bad' : ''}"><small>Positionsplan heute</small><b>${d.position_plans_today.length}/3</b><span><a href="#/manage/positions">planen →</a></span></article>
      <article class="stat ${d.stock_below_min ? 'bad' : ''}"><small>Unter Mindestbestand</small><b>${d.stock_below_min}</b><span>${d.unknown_codes} unbekannte Codes</span></article>
    </div>
    <h2>${icon('oil')} Öl</h2><div class="stats">${d.oil.map((o) => `<article class="stat state-${o.state}"><small>${esc(o.name)}</small><b>${o.last_tpm ?? '–'} %</b><span>${esc({ ok: 'OK', warn: 'Prüfen', change: 'Wechsel nötig', unknown: o.reason === 'no_limit' ? 'Kein Grenzwert' : 'Keine Messung' }[o.state])}</span></article>`).join('')}</div>
    <h2>${icon('warn')} Benachrichtigungen (in der App)</h2>
    <p class="note">Externe Kanäle (E-Mail/Push): ${S.config.notification_channels.length ? esc(S.config.notification_channels.join(', ')) : 'keine konfiguriert – Meldungen erscheinen nur hier.'}</p>
    <ul class="plain">${d.notifications.map((n) => `<li>${fmtTime(n.created_at)} · ${esc(n.message)}</li>`).join('') || '<li>–</li>'}</ul>`).join('');
}

const DSTATE = { none: ['–', ''], open: ['offen', ''], on_time: ['rechtzeitig', 'ok'], late_done: ['verspätet', 'change'], missed: ['Frist verpasst', 'change'] };
async function mDaily() {
  const r = await get(`/api/daily/report?branch=${S.branch}`);
  const cell = (x) => `<td><span class="badge ${DSTATE[x.state][1]}">${DSTATE[x.state][0]}</span>${x.by ? `<br><small>${esc(x.by)} · ${new Date(x.submitted_at).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })}</small>` : ''}</td>`;
  return `<h1>${icon('box')} Tagesinventur – wer hat rechtzeitig abgegeben?</h1>
    <table class="tbl"><thead><tr><th>Datum</th><th>Frühschicht (bis ${esc(r.deadlines.early)})</th><th>Spätschicht (bis ${esc(r.deadlines.late)})</th></tr></thead><tbody>
    ${r.days.map((d) => `<tr><td>${new Date(d.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>${cell(d.early)}${cell(d.late)}</tr>`).join('')}</tbody></table>
    ${r.meat ? `<h2>Fleisch-Inventur (letzte Abgabe: ${esc(new Date(r.meat.date).toLocaleDateString('de-DE'))}, ${r.meat.shift === 'early' ? 'Früh' : 'Spät'})</h2>
      <table class="tbl"><thead><tr><th>Fleischart</th><th>Anfang</th><th>Zugang</th><th>Verbrauch</th><th>Rest</th><th>mariniert</th><th>nicht verwendbar</th></tr></thead><tbody>
      ${r.meat.lines.map((l) => `<tr><td>${esc(l.item)}</td><td>${l.start ?? '–'}</td><td>${l.incoming ?? '–'}</td><td><b>${l.usage ?? '–'}</b></td><td>${l.rest} ${esc(l.unit)}</td><td>${l.marinated ?? '–'}</td><td>${l.unusable ?? '–'}</td></tr>`).join('')}</tbody></table>
      <p class="note">Verbrauch = Anfangsbestand + Zugang (Wareneingang) − Restbestand − nicht verwendbare Ware.</p>` : ''}
    ${isManager() ? `<h2>Fristen</h2><form data-submit="daily-settings" class="inline card"><label>Frühschicht bis<input name="early" type="time" value="${esc(r.deadlines.early)}"></label><label>Spätschicht bis<input name="late" type="time" value="${esc(r.deadlines.late)}"></label><button class="small primary">Speichern</button></form>` : ''}`;
}

async function mControls() {
  const d = await get(`/api/controls?branch=${S.branch}`);
  const st = { open: ['offen', 'warn'], overdue: ['überfällig', 'change'], done: ['erledigt', 'ok'], late_done: ['verspätet', 'warn'], rework: ['Nacharbeit', 'change'] };
  const wd = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const rhythm = (l) => l.schedule === 'daily' ? 'täglich' : l.schedule === 'weekly' ? `wöchentlich (${wd[l.weekday]})` : `alle ${l.interval_days} Tage ab ${l.start_date}`;
  const runRow = (r) => `<tr><td>${esc(r.list)}</td><td>${esc(r.due_time)}</td><td><span class="badge ${st[r.state][1]}">${st[r.state][0]}</span>${r.reviewed ? ' ✓' : ''}</td>
    <td>${['done', 'late_done'].includes(r.state) ? esc(r.completed_name || '') : `<select data-change="ctl-assign" data-id="${r.id}" aria-label="Verantwortlich"><option value="">${r.assigned_name ? esc(r.assigned_name) : '– nicht zugewiesen –'}</option>${d.staff.map((p) => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('')}</select>`}</td>
    <td>${['done', 'late_done'].includes(r.state) && !r.reviewed ? `<form data-submit="ctl-review" data-id="${r.id}" class="inline"><input name="note" placeholder="Notiz" aria-label="Notiz"><button class="small primary" value="ok">ok</button><button class="small" value="rework">Nacharbeit</button></form>` : ''} <a href="#/control/${r.id}">ansehen</a></td></tr>`;
  return `<h1>${icon('box')} Kontrolllisten</h1>
    <p class="note">Einfache Ist-Mengen-Kontrolle als persönliche Aufgabe – keine Buchungen, keine Preise, keine automatischen Bestellungen. Erinnerung: 10 Min. vorher, bei Fälligkeit und +5 Min. an die verantwortliche Person, +10 Min. an die Filialleitung. Kein automatischer Anruf.</p>
    <h2>Heute (${esc(d.date)})</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Liste</th><th>Fällig</th><th>Status</th><th>Verantwortlich</th><th></th></tr></thead><tbody>${d.runs.map(runRow).join('') || '<tr><td colspan="5">Heute keine Kontrolle fällig.</td></tr>'}</tbody></table></div>
    <h2>Unter Mindestbestand (letzte Kontrolle)</h2><ul class="plain">${d.below.map((b) => `<li>${icon('warn')} <b>${esc(b.name)}</b>: ${b.qty} / min. ${b.min_qty} ${esc(b.unit)} <small>(${esc(b.list)}, ${fmtTime(b.completed_at)})</small></li>`).join('') || '<li>Nichts unter Mindestbestand.</li>'}</ul>
    ${d.missing_min ? `<p class="banner">${icon('warn')} ${d.missing_min} Artikel ohne Mindestwert – unten eintragen (leer = offen, wird nicht erfunden).</p>` : ''}
    <h2>Verbrauchsfrist mariniertes Fleisch</h2>
    <form data-submit="ctl-settings" class="form card inline"><label>Stunden (aus freigegebenem HACCP-Plan, leer = offen)<input name="use_within_hours" type="number" min="1" max="168" value="${d.use_within_hours ?? ''}"></label>
      <label>Quelle<input name="source" placeholder="z. B. HACCP-Plan, Version/Datum"></label><button class="primary">Speichern</button></form>
    <h2>Listen & Artikel</h2>
    ${d.lists.map((l) => `<details class="card"><summary><b>${esc(l.name)}</b> · ${esc(rhythm(l))} · ${esc(l.due_times)} Uhr${l.active ? '' : ' · inaktiv'}</summary>
      <form data-submit="ctl-list" data-id="${l.id}" class="form"><div class="grid2">
        <label>Rhythmus<select name="schedule"><option value="daily" ${l.schedule === 'daily' ? 'selected' : ''}>täglich</option><option value="weekly" ${l.schedule === 'weekly' ? 'selected' : ''}>wöchentlich</option><option value="interval" ${l.schedule === 'interval' ? 'selected' : ''}>alle N Tage</option></select></label>
        <label>Wochentag (bei wöchentlich)<select name="weekday">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${l.weekday === n ? 'selected' : ''}>${wd[n]}</option>`).join('')}</select></label>
        <label>Alle N Tage<input name="interval_days" type="number" min="2" max="60" value="${l.interval_days ?? 3}"></label><label>Startdatum<input name="start_date" type="date" value="${esc(l.start_date || '')}"></label>
        <label>Fällig um (HH:MM, mehrere mit Komma)<input name="due_times" value="${esc(l.due_times)}" required></label></div>
        <label class="check"><input type="checkbox" name="photo_required" ${l.photo_required ? 'checked' : ''}> Foto Pflicht</label><label class="check"><input type="checkbox" name="active" ${l.active ? 'checked' : ''}> aktiv</label>
        <button class="primary">Liste speichern</button></form>
      <table class="tbl"><thead><tr><th>Artikel</th><th>Einheit</th><th>Mindestwert</th><th></th></tr></thead><tbody>
      ${l.items.map((i) => `<tr><td>${esc(i.name)}</td><td colspan="3"><form data-submit="ctl-item" data-id="${i.id}" class="inline"><input name="unit" value="${esc(i.unit)}" aria-label="Einheit" size="8">
        <input name="min_qty" type="number" step="0.01" min="0" value="${i.min_qty ?? ''}" placeholder="offen" aria-label="Mindestwert" size="6"><button class="small">speichern</button></form></td></tr>`).join('')}</tbody></table>
      <form data-submit="ctl-item-new" data-id="${l.id}" class="inline"><input name="name" placeholder="Neuer Artikel" required aria-label="Neuer Artikel"><input name="unit" placeholder="Einheit" aria-label="Einheit" size="8"><input name="min_qty" type="number" step="0.01" min="0" placeholder="min." aria-label="Mindestwert" size="6"><button class="small primary">hinzufügen</button></form>
    </details>`).join('')}`;
}

async function mAcademy(arg) {
  const d = await get(`/api/train/overview?branch=${S.branch}`);
  let html = `<h1>${icon('school')} Schulungsbereiche</h1>
    <p class="note">10 Bereiche × 3 Stufen. Ziel: ${d.pool_target} Fragen je Stufe; prüfbar ab ${d.exam_min} freigegebenen Fragen. Bestanden ab 80 % und alle Sicherheitsfragen richtig. Danach praktische Freigabe durch Trainer/Leitung → Zertifikat.</p>
    <h2>Praktische Freigabe offen (${d.pending.length})</h2>
    ${d.pending.map((p) => `<form data-submit="train-signoff" data-module="${p.module_id}" data-user="${p.user_id}" class="card form"><b>${esc(p.name)}</b> · ${esc(p.title)} <small>Theorie bestanden ${fmtTime(p.passed_at)}</small>
      ${d.can_sign ? `<label>Notiz<input name="note" placeholder="z. B. Station sauber gezeigt"></label><button class="primary">Praktisch freigeben</button>` : '<p class="note">Freigabe nur durch Trainer oder Leitung.</p>'}</form>`).join('') || '<p class="note">Keine offenen Freigaben.</p>'}
    <h2>Stand je Mitarbeiter (höchste zertifizierte Stufe)</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mitarbeiter</th>${d.areas.map((a) => `<th title="${esc(a.title)}">${esc(a.title)}</th>`).join('')}</tr></thead><tbody>
    ${d.people.map((p) => `<tr><td>${esc(p.display_name)}</td>${d.areas.map((a) => `<td class="${p.levels[a.id] ? 'ok-cell' : ''}">${p.levels[a.id] ? '★'.repeat(p.levels[a.id]) : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <h2>Fragenpool & offene Punkte</h2><table class="tbl"><thead><tr><th>Bereich</th><th>Stationen</th><th>Stufe 1</th><th>Stufe 2</th><th>Stufe 3</th></tr></thead><tbody>
    ${d.areas.map((a) => `<tr><td>${esc(a.title)}</td><td>${a.stations.map(esc).join(', ') || '–'}</td>${a.modules.map((m) => `<td><span class="badge ${m.active >= d.pool_target ? 'ok' : m.active >= d.exam_min ? 'warn' : 'change'}">${m.active}/${d.pool_target}</span>${m.open_points ? ` <small>${m.open_points} offen</small>` : ''}${S.me.is_admin ? ` <a href="#/manage/academy/${m.id}">bearbeiten</a>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  if (arg && S.me.is_admin) html += await academyEditor(Number(arg));
  return html;
}

async function academyEditor(id) {
  const m = await get(`/api/train/modules/${id}/edit`);
  const st = (L) => (m.content[L]?.steps || []).join('\n');
  const qForm = (q) => {
    const c = q?.content || {};
    const f = (L) => { const x = c[L] || { options: [] }; return `<fieldset><legend>${L.toUpperCase()}${L === 'de' ? ' (Pflicht)' : ' (optional, sonst Deutsch)'}</legend>
      <label>Frage<input name="${L}_q" value="${esc(x.q || '')}" ${L === 'de' ? 'required' : ''} ${L === 'ar' ? 'dir="rtl"' : ''}></label>
      <label>Richtige Antwort<input name="${L}_a" value="${esc(x.options[0] || '')}" ${L === 'de' ? 'required' : ''} ${L === 'ar' ? 'dir="rtl"' : ''}></label>
      <div class="grid2"><label>Falsch 1<input name="${L}_b" value="${esc(x.options[1] || '')}" ${L === 'ar' ? 'dir="rtl"' : ''}></label><label>Falsch 2<input name="${L}_c" value="${esc(x.options[2] || '')}" ${L === 'ar' ? 'dir="rtl"' : ''}></label></div>
      <label>Erklärung bei Fehler<input name="${L}_x" value="${esc(x.explain || '')}" ${L === 'ar' ? 'dir="rtl"' : ''}></label></fieldset>`; };
    return `<details class="card"><summary>${q ? `${esc(c.de?.q || '')} ${q.safety ? '🛡' : ''} <small>(${esc(q.status)})</small>` : `${icon('add')} Neue Frage`}</summary>
      <form data-submit="train-question" ${q ? `data-id="${q.id}"` : `data-module="${m.id}"`} class="form">${f('de')}${f('en')}${f('ar')}
      <label class="check"><input type="checkbox" name="safety" ${q?.safety ? 'checked' : ''}> Sicherheits-/Hygienefrage (muss richtig sein)</label>
      <label>Status<select name="status"><option value="active" ${q?.status === 'active' || !q ? 'selected' : ''}>aktiv (in der Prüfung)</option><option value="open" ${q?.status === 'open' ? 'selected' : ''}>offen (wartet auf Inhalte)</option>${q ? '<option value="archived">archivieren</option>' : ''}</select></label>
      <button class="primary">Speichern</button></form></details>`;
  };
  return `<h2 id="editor">${icon('edit')} ${esc(m.title)} bearbeiten <small>(Version ${m.version})</small></h2>
    <form data-submit="train-module" data-id="${m.id}" class="form card">
      <label>Lernschritte DE (eine Zeile je Schritt)<textarea name="steps_de" rows="5" required>${esc(st('de'))}</textarea></label>
      <label>Lernschritte EN<textarea name="steps_en" rows="4">${esc(st('en'))}</textarea></label>
      <label>Lernschritte AR<textarea name="steps_ar" rows="4" dir="rtl">${esc(st('ar'))}</textarea></label>
      <label>Video-Link (https, optional)<input name="video_url" value="${esc(m.video_url)}" placeholder="https://"></label>
      <label>Offene Punkte (eine Zeile je Punkt)<textarea name="open_points" rows="3">${esc(m.open_points.join('\n'))}</textarea></label>
      <label class="check"><input type="checkbox" name="practical_required" ${m.practical_required ? 'checked' : ''}> Praktische Freigabe erforderlich</label>
      <label class="check"><input type="checkbox" name="rev_en" ${m.reviewed_langs.includes('en') ? 'checked' : ''}> Englisch fachlich geprüft</label>
      <label class="check"><input type="checkbox" name="rev_ar" ${m.reviewed_langs.includes('ar') ? 'checked' : ''}> Arabisch fachlich geprüft</label>
      <button class="primary">Inhalte speichern</button></form>
    <h3>Fragen (${m.questions.filter((q) => q.status === 'active').length} aktiv)</h3>${qForm(null)}${m.questions.map(qForm).join('')}`;
}

async function mStaff() {
  const list = await get(`/api/staff?branch=${S.branch}`);
  const inv = S.lastInvite; S.lastInvite = null;
  const roleBox = (p, r, label) => `<label class="check"><input type="checkbox" data-change="staff-role" value="${r}" ${p.roles.includes(r) ? 'checked' : ''} ${p.roles.includes('manager') && !S.me.is_admin ? 'disabled' : ''}> ${label}</label>`;
  const st = { approved: 'ok', pending: 'warn' };
  return `<h1>${icon('lock')} Mitarbeiter & Zugänge</h1>
    <p class="note">Jeder Mitarbeiter bekommt einen eigenen Zugang – keine Sammelkonten. Statt eines Passworts erhält die Person einen Einladungscode (7 Tage gültig) und legt ihr Passwort selbst fest.</p>
    ${inv ? `<section class="card invite-card"><h2>${icon('lock')} Einladungscode für ${esc(inv.name || inv.username || '')}</h2><p class="invite-code">${esc(inv.invite_code)}</p>
      <p class="note">Benutzer: <b>${esc(inv.username || '')}</b> · gültig bis ${fmtTime(inv.expires_at)}. Persönlich übergeben. Anmeldung: Startseite → „Mit Einladungscode anmelden“. Der Code wird nicht noch einmal angezeigt.</p></section>` : ''}
    <form data-submit="staff-new" class="form card"><h2>${icon('add')} Neuer Mitarbeiter</h2><div class="grid2">
      <label>Name<input name="display_name" required></label><label>Benutzername<input name="username" required pattern="[A-Za-z0-9._-]{3,40}" placeholder="vorname.nachname"></label>
      <label>Rolle<select name="role"><option value="employee">Mitarbeiter</option><option value="shift_lead">Schichtführer</option><option value="trainer">Trainer</option>${S.me.is_admin ? '<option value="manager">Filialleitung</option>' : ''}</select></label></div>
      <button class="primary">Konto anlegen & Code erzeugen</button></form>
    <table class="tbl"><thead><tr><th>Mitarbeiter</th><th>Rollen</th><th>Zugang</th><th>§43 / METRO</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr data-user="${p.id}" class="${p.active ? '' : 'inactive-row'}"><td>${esc(p.display_name)}<br><small>${esc(p.username)}</small></td>
      <td>${roleBox(p, 'employee', 'Mitarbeiter')}${roleBox(p, 'shift_lead', 'Schichtführer')}${roleBox(p, 'trainer', 'Trainer')}${p.roles.includes('manager') ? '<small>Filialleitung</small>' : ''}</td>
      <td>${!p.active ? '<span class="badge change">deaktiviert</span>' : p.has_password ? '<span class="badge ok">aktiv</span>' : `<span class="badge warn">Einladung offen</span>${p.invite ? `<br><small>bis ${fmtTime(p.invite.expires_at)}</small>` : ''}`}</td>
      <td><span class="badge ${st[p.ifsg43] || 'change'}">§43 ${esc({ approved: 'ok', pending: 'Prüfung', missing: 'fehlt', rejected: 'abgelehnt', expired: 'abgelaufen' }[p.ifsg43])}</span> <span class="badge ${st[p.metro_hygiene] || ''}">METRO ${esc({ approved: 'ok', pending: 'Prüfung', missing: 'fehlt', rejected: 'abgelehnt', expired: 'abgelaufen' }[p.metro_hygiene])}</span></td>
      <td>${p.id !== S.me.id && !p.roles.includes('manager') ? `<button class="small" data-action="staff-reset" data-id="${p.id}" data-name="${esc(p.display_name)}">Passwort zurücksetzen</button>
        <button class="small" data-action="staff-active" data-id="${p.id}" data-val="${p.active ? 0 : 1}">${p.active ? 'deaktivieren' : 'aktivieren'}</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

async function mCerts() {
  const d = await get(`/api/certificates?branch=${S.branch}`);
  const lbl = { approved: ['bestätigt', 'ok'], pending: ['in Prüfung', 'warn'], missing: ['fehlt', 'change'], rejected: ['abgelehnt', 'change'], expired: ['abgelaufen', 'change'] };
  const b = (st) => `<span class="badge ${lbl[st.state][1]}">${lbl[st.state][0]}</span>${st.valid_until ? `<br><small>bis ${new Date(st.valid_until).toLocaleDateString('de-DE')}</small>` : ''}`;
  return `<h1>${icon('shield')} Nachweise: §43 IfSG & METRO-Hygieneschulung</h1>
    <p class="note">Gesetzliche Tätigkeitsvoraussetzung: Belehrung nach §43 IfSG vor der ersten Tätigkeit mit Lebensmitteln. Die METRO-Schulung ersetzt sie nicht. Folgebelehrungen durch den Betrieb hier dokumentieren. Fristen bitte mit Ihrem Fachberater festlegen.</p>
    <h2>Zur Prüfung (${d.pending.length})</h2>
    ${d.pending.map((c) => `<form data-submit="cert-review" data-id="${c.id}" class="card form"><h3>${esc(c.user)} · ${esc(c.type_label)}</h3>
      <p>Ausgestellt ${esc(c.issued_on || '–')}${c.valid_until ? ' · gültig bis ' + esc(c.valid_until) : ''} · hochgeladen ${fmtTime(c.uploaded_at)}</p>
      <a class="secondary" href="/api/media/${c.media_id}" target="_blank" rel="noopener">${icon('eye')} Dokument ansehen</a>
      <label>Notiz (Pflicht bei Ablehnung)<input name="note"></label>
      <div class="row"><button class="danger" name="act" value="rejected">Ablehnen</button><button class="primary" name="act" value="approved">Bestätigen</button></div></form>`).join('') || '<p class="note">Nichts zu prüfen.</p>'}
    <h2>Übersicht</h2><table class="tbl"><thead><tr><th>Mitarbeiter</th><th>§43 IfSG</th><th>METRO</th><th>Letzte Folgebelehrung</th></tr></thead><tbody>
    ${d.people.map((p) => `<tr><td>${esc(p.display_name)}</td><td>${b(p.ifsg43)}</td><td>${b(p.metro_hygiene)}</td>
      <td>${p.last_followup ? new Date(p.last_followup).toLocaleDateString('de-DE') : '–'}<form data-submit="cert-followup" data-user="${p.id}" class="inline"><input name="issued_on" type="date" required aria-label="Datum"><button class="small">eintragen</button></form></td></tr>`).join('')}</tbody></table>
    ${S.me.is_admin ? `<h2>Hinweise & offizielle Links (Betreiber)</h2><form data-submit="cert-links" class="form card">
      <label>§43: Hinweistext<textarea name="ifsg_text" rows="2">${esc(d.links.ifsg43.text)}</textarea></label><label>§43: Link (https)<input name="ifsg_url" value="${esc(d.links.ifsg43.url)}"></label>
      <label>METRO: Hinweistext<textarea name="metro_text" rows="2">${esc(d.links.metro_hygiene.text)}</textarea></label><label>METRO: Link (https)<input name="metro_url" value="${esc(d.links.metro_hygiene.url)}"></label>
      <button class="primary">Speichern</button></form>` : ''}`;
}

async function mStaffing(arg) {
  const sh = ['open', 'run', 'close'].includes(arg) ? arg : S.shift;
  const [p, tasks] = await Promise.all([get(`/api/presence?${qs({ branch: S.branch, shift: sh })}`), get(`/api/shift/tasks?${qs({ branch: S.branch, shift: sh })}`)]);
  const present = p.people.filter((x) => x.present);
  const statusDE = { open: 'offen', rework: 'Nacharbeit', done: 'erledigt', approved: 'freigegeben', problem: 'Problem' };
  return `<h1>${icon('user')} Besetzung & Aufgabenverteilung</h1>
    <div class="segs">${['open', 'run', 'close'].map((s) => `<a class="seg ${s === sh ? 'on' : ''}" href="#/manage/staffing/${s}">${SHIFT_DE[s]}</a>`).join('')}</div>
    <p class="note">Keine Zeiterfassung – nur wer in dieser Schicht eingeteilt ist. Aufgaben werden automatisch und gleichmäßig an eingeteilte, qualifizierte Personen verteilt. Bei Abwesenheit wird neu verteilt.</p>
    <table class="tbl"><thead><tr><th>Person</th><th>Status</th><th>offen</th><th>erledigt</th><th></th></tr></thead><tbody>
    ${p.people.map((x) => `<tr><td>${esc(x.display_name)}</td><td>${x.status === 'absent' ? '<span class="badge change">abwesend</span>' : x.present ? '<span class="badge ok">eingeteilt</span>' : '–'}</td><td>${x.open_tasks}</td><td>${x.done_tasks}</td>
      <td>${x.present ? `<button class="small" data-action="presence-set" data-shift="${sh}" data-user="${x.id}" data-status="absent">abwesend</button>` : `<button class="small primary" data-action="presence-set" data-shift="${sh}" data-user="${x.id}" data-status="present">einteilen</button>`}</td></tr>`).join('')}</tbody></table>
    <h2>Aufgaben dieser Schicht</h2>
    <table class="tbl"><thead><tr><th>Aufgabe</th><th>Status</th><th>Zuständig</th></tr></thead><tbody>
    ${tasks.map((t) => `<tr class="st-${t.status}"><td>${icon(t.icon)} ${esc(t.title)}${t.overdue ? ' <span class="badge change">überfällig</span>' : ''}${t.role === 'shift_lead' ? ' <small>(Schichtführer)</small>' : ''}</td><td>${esc(statusDE[t.status] || t.status)}${t.completed_by ? `<br><small>${esc(t.completed_by)} ${fmtTime(t.completed_at)}</small>` : ''}</td>
      <td>${['open', 'rework'].includes(t.status) ? `<select class="small-select" data-change="task-assign" data-id="${t.id}"><option value="">– nicht zugewiesen –</option>${present.map((x) => `<option value="${x.id}" ${x.id === t.assigned_to ? 'selected' : ''}>${esc(x.display_name)}</option>`).join('')}</select>${t.assignment_mode === 'manual' ? ' <small>manuell</small>' : ''}`
        : ['done', 'approved'].includes(t.status) ? `<input id="return-${t.id}" class="small-select" placeholder="Grund"><button class="small" data-action="task-return" data-id="${t.id}">zurückgeben</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

async function mWeek(arg) {
  const w = await get(`/api/reports/week?${qs({ branch: S.branch, week: arg })}`);
  const ds = { none: '–', open: 'offen', on_time: '✓', late_done: 'verspätet', missed: '✗' };
  return `<h1>${icon('report')} Wochenbericht ${esc(w.branch)} · ${esc(w.week)}</h1><p class="note">${new Date(w.from).toLocaleDateString('de-DE')} – ${new Date(w.to).toLocaleDateString('de-DE')}</p>
    <table class="tbl"><thead><tr><th>Tag</th><th>erledigt</th><th>offen</th><th>Problem</th><th>Tagesinv. Früh</th><th>Spät</th></tr></thead><tbody>
    ${w.days.map((d) => `<tr><td>${new Date(d.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td><td>${d.done}/${d.total}</td><td>${d.open}</td><td>${d.problem}</td><td>${ds[d.daily_early]}</td><td>${ds[d.daily_late]}</td></tr>`).join('')}</tbody></table>
    <div class="stats"><article class="stat"><small>Reinigung</small><b>${w.cleaning.done}/${w.cleaning.total}</b></article><article class="stat"><small>Probleme</small><b>${w.problems.opened}</b><span>${w.problems.resolved} gelöst</span></article>
      <article class="stat ${w.weekly_inventory !== 'submitted' ? 'bad' : ''}"><small>Wochen-Inventur</small><b>${w.weekly_inventory === 'submitted' ? 'erledigt' : 'offen'}</b></article><article class="stat ${w.pest.infestations ? 'bad' : ''}"><small>Schädlingskontrollen</small><b>${w.pest.checks}</b><span>${w.pest.infestations} mit Befund</span></article></div>
    <h2>Erledigt je Person</h2><ul class="plain">${w.people.map((p) => `<li>${esc(p.name)}: ${p.n}</li>`).join('') || '<li>–</li>'}</ul>
    <h2>Offen je Verantwortlichem</h2><ul class="plain">${w.open_assigned.map((p) => `<li>${esc(p.name)}: ${p.n}</li>`).join('') || '<li>–</li>'}</ul>
    <h2>Überfällig</h2><ul class="plain">${w.overdue.map((o) => `<li>${new Date(o.work_date).toLocaleDateString('de-DE')} · ${esc(o.title)}${o.assigned ? ' · ' + esc(o.assigned) : ''}</li>`).join('') || '<li>–</li>'}</ul>
    <h2>Öl (Wechsel/Filtern)</h2><ul class="plain">${w.oil.map((o) => `<li>${fmtTime(o.at)} · ${esc(o.name)} · ${o.type === 'change' ? 'Wechsel' : 'Filtern'}${o.reason ? ' (' + esc({ planned: 'planmäßig', early: 'vorzeitig', quality: 'Qualität' }[o.reason]) + ')' : ''} · ${esc(o.by)}</li>`).join('') || '<li>–</li>'}</ul>
    <button class="secondary" data-action="print">Drucken / PDF</button>`;
}

async function mRecipes(arg) {
  const list = await get('/api/admin/marinades');
  const r = arg === 'neu' ? null : list.find((x) => x.id === Number(arg));
  if (arg) {
    const ing = r?.ingredients || [];
    return `<h1>${icon('prep')} ${r ? esc(r.name) + ' – neue Version' : 'Neue Rezeptur'}</h1>
      <p class="note">Rezepturen werden nur in der Datenbank gespeichert, nicht im Code-Repository. Jede Änderung ist eine neue Version; bestehende Chargen behalten ihre Version.</p>
      <form data-submit="recipe" ${r ? `data-id="${r.id}"` : ''} class="form">
        ${r ? '' : '<label>Name<input name="name" required></label>'}
        <h3>Zutaten je 1 kg Fleisch</h3>
        ${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<div class="grid3"><input name="in${k}" placeholder="Zutat ${k + 1}" value="${esc(ing[k]?.name || '')}" aria-label="Zutat ${k + 1}">
          <input name="ip${k}" type="number" step="0.01" min="0" placeholder="Menge" value="${ing[k]?.per_kg ?? ''}" aria-label="Menge ${k + 1}">
          <select name="iu${k}" aria-label="Einheit ${k + 1}">${['g', 'kg', 'ml', 'L', 'Stück'].map((u) => `<option ${(ing[k]?.unit || 'g') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>`).join('')}
        <label>Allergene (laut Allergenliste)<input name="allergens" value="${esc(r?.allergens || '')}"></label>
        <div class="grid2"><label>Erlaubte Abweichung beim Abwiegen (%, leer = nur melden)<input name="tolerance_percent" type="number" step="0.5" min="0" max="50" value="${r?.tolerance_percent ?? ''}"></label>
        <label>Verwendbar (Stunden, leer = keine Frist)<input name="use_within_hours" type="number" min="1" max="336" value="${r?.use_within_hours ?? ''}"></label>
        <label>Quelle der Frist (Pflicht bei Frist)<input name="use_source" value="${esc(r?.use_source || '')}"></label></div>
        <button class="primary">Speichern</button></form>`;
  }
  return `<h1>${icon('prep')} Rezepturen (Marinaden)</h1><p class="note">Nur der Betreiber sieht und ändert diese Seite.</p>
    ${list.map((m) => `<section class="card"><h2>${esc(m.name)} <small>v${m.version}</small></h2><ul class="plain">${m.ingredients.map((i) => `<li>${esc(i.name)}: ${i.per_kg} ${esc(i.unit)} je kg</li>`).join('')}</ul>
      <a class="secondary" href="#/manage/recipes/${m.id}">${icon('edit')} Neue Version</a></section>`).join('') || '<p>Noch keine Rezeptur.</p>'}
    <a class="primary" href="#/manage/recipes/neu">${icon('add')} Neue Rezeptur</a>`;
}

async function mOnboarding() {
  const d = await get(`/api/onboarding?branch=${S.branch}`);
  return `<h1>${icon('shield')} Einarbeitungsbestätigung (Handbuch v${d.version})</h1>
    <p class="note">Trainer trägt die Bereiche der Einweisung ein, danach bestätigt der Mitarbeiter selbst in der App.</p>
    ${d.people.map((p) => { const c = p.confirmation;
      return `<form data-submit="onboarding-trainer" data-user="${p.id}" class="card form"><h2>${esc(p.display_name)} ${c ? (c.employee_confirmed_at ? '<span class="badge ok">bestätigt</span>' : '<span class="badge warn">Mitarbeiter muss bestätigen</span>') : '<span class="badge">offen</span>'}</h2>
        ${c ? `<p class="note">Eingewiesen durch ${esc(c.trainer)} am ${fmtTime(c.trainer_confirmed_at)}${c.employee_confirmed_at ? ` · bestätigt ${fmtTime(c.employee_confirmed_at)}` : ''}</p>` : ''}
        <div class="area-grid">${d.areas.map((a) => `<label class="check"><input type="checkbox" name="area" value="${esc(a)}" ${c?.areas.includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div>
        <button class="small primary">Einweisung eintragen</button></form>`; }).join('')}`;
}

let planDraft = null;
async function mPositions(arg) {
  const [shiftArg] = (arg || '').split('/');
  const sh = ['open', 'run', 'close'].includes(shiftArg) ? shiftArg : S.shift;
  // Lokale Änderungen am Entwurf ohne neue Serverabfrage anzeigen (schnell, keine verlorenen Eingaben)
  const local = S.planLocal && planDraft?.data && planDraft.shift === sh;
  S.planLocal = false;
  const d = local ? planDraft.data : await get(`/api/positions?${qs({ branch: S.branch, shift: sh })}`);
  const key = `${S.branch}/${d.date}/${sh}`;
  if (!planDraft || planDraft.key !== key) planDraft = { key, shift: sh, list: d.stations.flatMap((s) => s.assigned.map((a) => ({ station_id: s.id, user_id: a.user_id, training: a.training }))) };
  planDraft.data = d;
  const name = (id) => d.staff.find((p) => p.id === id)?.display_name || '?';
  return `<h1>${icon('store')} Positionsplan · ${esc(d.date)}</h1>
    <div class="segs">${['open', 'run', 'close'].map((s) => `<a class="seg ${s === sh ? 'on' : ''}" href="#/manage/positions/${s}">${SHIFT_DE[s]}</a>`).join('')}</div>
    <p class="note">Nur Personen mit bestandenem Stationscheck. Neue Leute nur als „Einarbeitung“ zusammen mit einer freigegebenen Person.${d.updated_at ? ' Zuletzt gespeichert: ' + fmtTime(d.updated_at) : ' Noch nicht gespeichert.'}</p>
    <div class="plan">${d.stations.map((s) => { const here = planDraft.list.filter((a) => a.station_id === s.id);
      return `<section class="card plan-station"><h2>${icon(s.icon)} ${esc(s.name)} <small>${here.length ? '' : '<span class="badge warn">nicht besetzt</span>'}</small></h2>
        <ul class="plain">${here.map((a) => `<li>${esc(name(a.user_id))} ${a.training ? '<span class="badge warn">Einarbeitung</span>' : '<span class="badge ok">freigegeben</span>'}
          <button class="small" data-action="plan-remove" data-station="${s.id}" data-user="${a.user_id}" aria-label="entfernen">✕</button></li>`).join('')}</ul>
        <form data-submit="plan-add" data-station="${s.id}" class="inline"><select name="user_id" required><option value="">Person wählen</option>
          ${d.staff.map((p) => `<option value="${p.id}">${s.certified_people.includes(p.id) ? '✓ ' : '○ '}${esc(p.display_name)}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" name="training"> Einarbeitung</label><button class="small">${icon('add')} Hinzufügen</button></form></section>`; }).join('')}</div>
    <button class="primary block" data-action="plan-save" data-shift="${sh}" data-date="${d.date}">${icon('check')} Plan speichern</button>`;
}

let observeSel = {};
async function mObserve() {
  const st = await get(`/api/stations?branch=${S.branch}`);
  const sid = Number(observeSel.station) || st.stations[0]?.id;
  const cl = sid ? await get(`/api/stations/${sid}/checklist`) : null;
  return `<h1>${icon('eye')} Stationscheck</h1><p class="note">Mitarbeiter an der Station beobachten und jeden Punkt bewerten. Kritische Punkte müssen erfüllt sein, sonst ist der Check nicht bestanden.</p>
    <label>Station<select data-change="observe-station">${st.stations.map((x) => `<option value="${x.id}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    ${cl ? `<form data-submit="observe" data-station="${sid}" class="form">
      <label>Mitarbeiter<select name="user_id" required><option value="">wählen</option>${cl.people.map((p) => `<option value="${p.id}" ${p.course_ok ? '' : 'disabled'}>${esc(p.display_name)}${p.certified ? ' (bereits freigegeben)' : ''}${p.course_ok ? '' : ' – Schulung fehlt'}</option>`).join('')}</select></label>
      <ol class="checklist">${cl.items.map((i) => `<li class="${i.critical ? 'critical' : ''}"><p>${esc(i.text)} ${i.critical ? '<span class="badge change">kritisch</span>' : ''}</p>
        <div class="yn"><label class="yes"><input type="radio" name="i${i.id}" value="1" required> ✓ erfüllt</label><label class="no"><input type="radio" name="i${i.id}" value="0"> ✗ nicht erfüllt</label></div></li>`).join('')}</ol>
      <label>Notiz / Feedback<textarea name="note" rows="2"></textarea></label>
      <button class="primary block">${icon('check')} Stationscheck speichern</button></form>` : ''}`;
}

async function mStations() {
  const m = await get(`/api/stations/matrix?branch=${S.branch}`);
  return `<h1>${icon('star')} Stationen & Stufen</h1>
    <p class="note">Stufen: 1 Neu · 2 Crew (mind. eine Station) · 3 Allrounder (alle Stationen) · 4 Trainer · 5 Schichtführer</p>
    <table class="tbl matrix"><thead><tr><th>Mitarbeiter</th><th>Stufe</th>${m.stations.map((s) => `<th title="${esc(s.name)}">${icon(s.icon)}<br><small>${esc(s.name)}</small></th>`).join('')}</tr></thead><tbody>
    ${m.people.map((p) => `<tr><td>${esc(p.display_name)}</td><td><span class="badge ${p.rank >= 3 ? 'ok' : ''}">${p.rank} ${esc(levelLabel(p.level))}</span></td>
      ${m.stations.map((s) => `<td class="cell ${p.stations[s.id] ? 'yes' : 'no'}">${p.stations[s.id] ? '✓' : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function mProducts() {
  const [products, st] = await Promise.all([get(`/api/products?branch=${S.branch}`), get(`/api/stations?branch=${S.branch}`)]);
  return `<h1>${icon('history')} Produkte & Haltezeiten</h1><p class="note">Zeiten nur aus Herstellerangabe, freigegebener Rezeptur oder HACCP-Plan – mit Quelle. Ohne Zeit kann kein Timer gestartet werden.</p>
    ${products.map((p) => `<form data-submit="product" data-id="${p.id}" class="card form"><h2>${icon(p.icon)} ${esc(p.name_de)} <small>${esc(st.stations.find((x) => x.id === p.station_id)?.name || '')}</small></h2>
      <div class="grid2"><label>Haltezeit (Minuten)<input name="hold_minutes" type="number" min="1" max="720" value="${p.hold_minutes ?? ''}"></label>
      <label>Garzeit/Programm (Sekunden)<input name="cook_seconds" type="number" min="10" max="7200" value="${p.cook_seconds ?? ''}"></label>
      <label>Quelle (Pflicht bei Werten)<input name="value_source" value="${esc(p.value_source || '')}"></label></div><button class="primary">Speichern</button></form>`).join('')}
    <h2>Neues Produkt</h2><form data-submit="product-new" class="form"><div class="grid2"><label>Name<input name="name_de" required></label>
      <label>Station<select name="station_id"><option value="">–</option>${st.stations.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label></div><button class="primary">${icon('add')} Anlegen</button></form>`;
}

async function mProblems() {
  const list = await get(`/api/problems?branch=${S.branch}`);
  return `<h1>${icon('warn')} Probleme & Abweichungen</h1>${list.map((p) => `<section class="card problem ${p.status}">
      <p><span class="badge ${p.status === 'resolved' ? 'ok' : 'warn'}">${esc({ open: 'offen', rework: 'Nacharbeit', resolved: 'erledigt' }[p.status])}</span> <small>${fmtTime(p.reported_at)} · ${esc(p.reported_by_name)} · Quelle: ${esc(p.source)}</small></p>
      ${p.task_title ? `<p><b>${esc(p.task_title)}</b></p>` : ''}<p>${esc(p.description)}</p>
      ${p.media_id ? `<img class="evidence" src="/api/media/${p.media_id}" alt="Foto zum Problem" loading="lazy">` : ''}
      ${p.manager_note ? `<p class="note">Leitung: ${esc(p.manager_note)}</p>` : ''}
      ${p.status !== 'resolved' ? `<form data-submit="problem-action" data-id="${p.id}" class="form"><label>Maßnahme / Notiz<input name="note" required minlength="2"></label>
        <div class="row">${p.occurrence_id ? '<button class="secondary" name="act" value="rework">Nacharbeit anfordern</button>' : ''}<button class="primary" name="act" value="resolve">Erledigt bestätigen</button></div></form>` : ''}
    </section>`).join('') || '<p>Keine Probleme.</p>'}`;
}

async function mReport(arg) {
  const [shift, date] = (arg || '').split('/');
  const sh = ['open', 'run', 'close'].includes(shift) ? shift : 'open';
  const r = await get(`/api/reports/shift?${qs({ branch: S.branch, shift: sh, date })}`);
  return `<h1>${icon('report')} Schichtbericht ${esc(r.branch)} · ${esc(r.date)}</h1>
    <div class="segs">${['open', 'run', 'close'].map((s) => `<a class="seg ${s === sh ? 'on' : ''}" href="#/manage/report/${s}/${r.date}">${SHIFT_DE[s]}</a>`).join('')}</div>
    <div class="stats"><article class="stat"><small>Erledigt</small><b>${r.counts.done}/${r.counts.total}</b></article><article class="stat ${r.counts.open ? 'bad' : ''}"><small>Offen</small><b>${r.counts.open}</b></article>
      <article class="stat ${r.counts.problems ? 'bad' : ''}"><small>Probleme</small><b>${r.counts.problems}</b></article><article class="stat"><small>Fotos</small><b>${r.counts.photos}</b></article></div>
    <table class="tbl"><thead><tr><th>Aufgabe</th><th>Status</th><th>Wer / Wann</th><th>Nachweis</th></tr></thead><tbody>
    ${r.tasks.map((x) => `<tr class="st-${x.status}"><td>${icon(x.icon)} ${esc(x.title)}</td><td>${esc(STATUS_DE[x.status] || x.status)}</td><td>${esc(x.completed_by || '–')}<br><small>${fmtTime(x.completed_at)}</small></td>
      <td>${x.measured_value != null ? `${x.measured_value} ${esc(x.measure_unit)}<br>` : ''}${x.photos.map((m) => `<a href="/api/media/${m}" target="_blank" rel="noopener"><img class="mini" src="/api/media/${m}" alt="Nachweisfoto" loading="lazy"></a>`).join('')}</td></tr>`).join('')}</tbody></table>
    ${r.problems.length ? `<h2>Probleme</h2><ul class="plain">${r.problems.map((p) => `<li>${esc({ open: 'offen', rework: 'Nacharbeit', resolved: 'erledigt' }[p.status] || p.status)} · ${esc(p.description)}</li>`).join('')}</ul>` : ''}
    <h2>Öl</h2><ul class="plain">${r.oil.map((o) => `<li>${esc(o.name)}: ${o.last_tpm ?? '–'} % · ${esc(o.state)}</li>`).join('')}</ul>
    ${r.approval ? `<p class="banner ok">${icon('check')} Freigegeben von ${esc(r.approval.display_name)} am ${fmtTime(r.approval.approved_at)}${r.approval.note ? ' – ' + esc(r.approval.note) : ''}</p>`
      : `<form data-submit="approve-shift" data-shift="${sh}" data-date="${r.date}" class="form"><label>Begründung (nötig, wenn noch etwas offen ist)<input name="note"></label><button class="primary">${icon('check')} Schicht freigeben</button></form>`}
    <button class="secondary" data-action="print">Drucken / PDF</button>`;
}

async function mTemplates() {
  const [list, st] = await Promise.all([get(`/api/templates?branch=${S.branch}`), get(`/api/stations?branch=${S.branch}`)]);
  const stationSel = (tp) => `<select class="small-select" data-change="tpl-station" data-id="${tp.id}" aria-label="Station"><option value="">Allgemein</option>${st.stations.map((x) => `<option value="${x.id}" ${x.id === tp.station_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
  const byShift = { open: [], run: [], close: [] };
  list.forEach((tp) => byShift[tp.shift].push(tp));
  return `<h1>${icon('list')} Aufgaben-Vorlagen</h1><p class="note">Reihenfolge, Foto-Pflicht und Wochentage gelten nur für diese Filiale. Grenzwerte nur mit Quelle (HACCP-Plan/Herstellerangabe).</p>
    ${Object.entries(byShift).map(([s, arr]) => `<h2>${SHIFT_DE[s]}</h2><ul class="tpl-list">${arr.map((tp) => `<li class="${tp.active ? '' : 'inactive'}">
      <span>${icon(tp.icon)} <b>${esc(tp.title.de)}</b> <small class="badge">${esc(tp.station_name || 'Allgemein')}</small> <small>${esc(tp.frequency)}${tp.frequency !== 'monthly' ? ' · Tage ' + esc(tp.weekdays) : ' · Tag ' + tp.month_day}${tp.measure_unit ? ' · Messwert ' + esc(tp.measure_unit) + (tp.limit_min != null || tp.limit_max != null ? ` (${tp.limit_min ?? '–'}…${tp.limit_max ?? '–'})` : ' (kein Grenzwert)') : ''}</small></span>
      <span class="tpl-actions">
        <button class="small" data-action="tpl-move" data-id="${tp.id}" data-dir="up" aria-label="nach oben">${icon('up')}</button>
        <button class="small" data-action="tpl-move" data-id="${tp.id}" data-dir="down" aria-label="nach unten">${icon('down')}</button>
        <button class="small ${tp.requires_photo ? 'on' : ''}" data-action="tpl-photo" data-id="${tp.id}" data-val="${tp.requires_photo ? 0 : 1}">${icon('camera')} ${tp.requires_photo ? 'Pflicht' : 'optional'}</button>
        <button class="small" data-action="tpl-active" data-id="${tp.id}" data-val="${tp.active ? 0 : 1}">${tp.active ? 'aktiv' : 'aus'}</button>
        <button class="small ${tp.role === 'shift_lead' ? 'on' : ''}" data-action="tpl-role" data-id="${tp.id}" data-val="${tp.role === 'shift_lead' ? 'all' : 'shift_lead'}">${tp.role === 'shift_lead' ? 'Schichtführer' : 'alle'}</button>
        ${stationSel(tp)}
        ${tp.category === 'cleaning' ? `<input class="small-select" data-change="tpl-agent" data-id="${tp.id}" value="${esc(tp.cleaning_agent || '')}" placeholder="Reinigungsmittel (laut Plan)" aria-label="Reinigungsmittel">` : ''}
        ${tp.interval_days ? `<small class="badge">alle ${tp.interval_days} Tage</small>` : ''}
      </span></li>`).join('')}</ul>`).join('')}
    <h2>Neue Aufgabe</h2><form data-submit="tpl-new" class="form"><div class="grid2">
      <label>Schicht<select name="shift"><option value="open">Öffnung</option><option value="run">Betrieb</option><option value="close">Schließung</option></select></label>
      <label>Titel (kurz)<input name="title_de" required maxlength="120"></label><label>Hinweis (ein Satz)<input name="hint_de" maxlength="200"></label>
      <label>Station<select name="station_id"><option value="">Allgemein</option>${st.stations.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
      <label>Bereich<select name="category"><option value="routine">Routine</option><option value="cleaning">Reinigung</option><option value="maintenance">Wartung</option><option value="hygiene">Hygiene</option><option value="haccp">HACCP</option></select></label>
      <label>Intervall in Tagen ab letzter Erledigung (optional, z. B. Wartung)<input name="interval_days" type="number" min="1" max="365"></label>
      <label class="check"><input type="checkbox" name="requires_photo"> Foto Pflicht</label></div><button class="primary">${icon('add')} Anlegen</button></form>`;
}

async function mTraining() {
  const d = await get(`/api/training?branch=${S.branch}`);
  return `<h1>${icon('school')} Schulung & praktische Freigaben</h1>
    <table class="tbl"><thead><tr><th>Mitarbeiter</th>${d.courses.map((c) => `<th>${esc(c.title)}${c.safety_critical ? ' ' + icon('shield') : ''}</th>`).join('')}</tr></thead><tbody>
    ${d.people.map((p) => `<tr><td>${esc(p.display_name)}</td>${d.courses.map((c) => { const s = p.status[c.id];
      return `<td>${s.expired ? '<span class="badge change">abgelaufen</span>' : s.ok ? '<span class="badge ok">qualifiziert</span>' : s.exam ? (s.needsPractical && isTrainer() ? `<button class="small primary" data-action="signoff" data-user="${p.id}" data-course="${c.id}">Praktisch freigeben</button>` : '<span class="badge warn">Praxis fehlt</span>') : '<span class="badge">Prüfung fehlt</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
    <p class="note">Praktische Freigabe nur durch Trainer nach dokumentierter Einweisung am Gerät. Eigene Freigabe ist gesperrt.</p>
    ${S.me.is_admin ? `<h2>Gültigkeit & Pflicht</h2><p class="note">Nach Ablauf muss die Schulung wiederholt werden; offene Pflichtschulungen werden wöchentlich erinnert.</p>${d.courses.map((c) => `<form data-submit="course-settings" data-id="${c.id}" class="inline card"><b>${esc(c.title)}</b>
      <label>Gültig<select name="valid_months"><option value="">unbegrenzt</option>${[6, 12, 24, 36].map((m) => `<option value="${m}" ${c.valid_months === m ? 'selected' : ''}>${m} Monate</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="required" ${c.required ? 'checked' : ''}> Pflicht</label><button class="small primary">Speichern</button></form>`).join('')}` : ''}`;
}

async function mStock() {
  const [stock, unknown, items, rhythm] = await Promise.all([get(`/api/stock?branch=${S.branch}`), get(`/api/goods/unknown?branch=${S.branch}`), get('/api/items'), get(`/api/items/rhythm?branch=${S.branch}`)]);
  const rRow = (i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.category)}</td><td><select data-change="item-rhythm" data-id="${i.id}" aria-label="Zählrhythmus ${esc(i.name)}">
    <option value="daily" ${i.rhythm === 'daily' ? 'selected' : ''}>täglich (Früh + Spät)</option><option value="weekly" ${i.rhythm === 'weekly' ? 'selected' : ''}>nur wöchentlich</option></select></td></tr>`;
  return `<h1>${icon('box')} Bestand & Codes</h1>
    <h2>Zählrhythmus</h2><p class="note">„Täglich“ steht auf der Tagesinventur (Frühschicht und Spätschicht). Die Wocheninventur zählt immer alle Artikel – auch die nur wöchentlich gezählten wie Saucen und Marinaden.</p>
    <table class="tbl"><thead><tr><th>Artikel</th><th>Gruppe</th><th>Zählen</th></tr></thead><tbody>${rhythm.map(rRow).join('')}</tbody></table>
    ${stockTable(stock, true)}
    <h2>Nachbestellliste</h2><ul class="plain">${stock.filter((s) => s.below_min).map((s) => `<li>${esc(s.name)}: ${s.qty} / min. ${s.min_qty} ${esc(s.unit)}${s.metro_article_no ? ' · METRO ' + esc(s.metro_article_no) : ''}</li>`).join('') || '<li>Nichts nachzubestellen.</li>'}</ul>
    <h2>Unbekannte Codes zuordnen</h2>${unknown.map((u) => `<form data-submit="assign-code" data-id="${u.id}" class="inline card"><code>${esc(u.code)}</code> <small>${esc(u.kind)}</small>
      <select name="item_id" required><option value="">Artikel wählen</option>${items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select><button class="small primary">Zuordnen</button></form>`).join('') || '<p>Keine offenen Codes.</p>'}
    <h2>Neuer Artikel</h2><form data-submit="item-new" class="form"><div class="grid2"><label>Name<input name="name" required></label><label>Einheit<input name="unit" required placeholder="kg, L, Stück"></label>
      <label>METRO-Artikelnummer (vom Beleg/Etikett)<input name="metro_article_no"></label><label>Mindestbestand<input name="min_qty" type="number" step="0.01" min="0"></label>
      <label class="check"><input type="checkbox" name="needs_temperature"> Temperatur bei Annahme Pflicht</label></div><button class="primary">${icon('add')} Anlegen</button></form>
    <h2>METRO-Beleg erfassen</h2><p class="note">Beleg wird als Foto/PDF gespeichert, Belegnummer verhindert Doppelerfassung. Automatische Texterkennung und METRO-Schnittstelle sind nicht eingebaut (keine verifizierte Schnittstelle).</p>
    <form data-submit="receipt-doc" class="form"><label>Belegnummer<input name="receipt_no" required></label>${photoField('receipt', 'Beleg fotografieren / PDF')}<button class="primary">Speichern</button></form>`;
}

async function mOil() {
  const fryers = await get(`/api/oil?branch=${S.branch}`);
  return `<h1>${icon('oil')} Öl-Grenzwerte</h1><p class="note">Nur Werte aus Herstellerangabe oder freigegebenem HACCP-Plan eintragen – mit Quelle. Ohne Grenzwert entscheidet die Leitung; die App gibt dann keine Freigabe.</p>
    ${fryers.map((f) => `<form data-submit="oil-limits" data-id="${f.id}" class="card form"><h2>${esc(f.name)} <small>${esc(f.manufacturer || '')} ${esc(f.model || '')}</small></h2><div class="grid2">
      <label>Wechsel ab TPM %<input name="tpm_limit" type="number" step="0.5" min="1" max="100" value="${f.tpm_limit ?? ''}"></label>
      <label>Warnung ab TPM %<input name="tpm_warn" type="number" step="0.5" min="1" max="100" value="${f.tpm_warn ?? ''}"></label>
      <label>Quelle (Pflicht)<input name="limit_source" value="${esc(f.limit_source || '')}"></label><label>Ölprodukt<input name="oil_product" value="${esc(f.oil_product || '')}"></label>
      <label>Ölwechsel-Intervall (Tage)<input name="change_interval_days" type="number" min="1" max="60" value="${f.change_interval_days ?? ''}"></label>
      <label>Seriennummer Messgerät (für Import)<input name="device_serial" value="${esc(f.device_serial || '')}"></label></div>
      <p class="note">Nächster Wechsel = letzter tatsächlicher Wechsel + Intervall. Filtern/Nachfüllen/Messen setzen den Termin nicht zurück. ${f.next_change_due ? 'Nächster: ' + new Date(f.next_change_due).toLocaleDateString('de-DE') : ''}</p>
      <button class="primary">Speichern</button></form>`).join('')}
    <h2>Messwerte importieren</h2>
    <p class="note">Für Berichts-Exporte eines Messgeräts (z. B. VITO). Eine offizielle Live-Schnittstelle ist noch nicht geprüft – siehe docs/VITO.md. Format je Zeile: <code>Seriennummer;Zeitpunkt (ISO);TPM;Temperatur</code>. Doppelte Messungen werden übersprungen.</p>
    <form data-submit="oil-import" class="form"><textarea name="csv" rows="4" placeholder="DEMO-SN-1;2026-11-26T08:00:00Z;14;175"></textarea>
      <label class="check"><input type="checkbox" name="test"> Testdaten (werden gekennzeichnet und sperren nichts)</label><button class="primary">Importieren</button></form>`;
}

async function mAudit() {
  const rows = await get(`/api/audit?branch=${S.branch}`);
  return `<h1>${icon('history')} Protokoll (unveränderlich)</h1><table class="tbl"><thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Objekt</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${fmtTime(r.at)}</td><td>${esc(r.actor || 'System')}</td><td>${esc(r.action)}</td><td>${esc(r.entity)} ${r.entity_id ?? ''}</td></tr>`).join('')}</tbody></table>`;
}

async function mSops(arg) {
  const sops = await get('/api/admin/sops');
  if (arg) {
    const s = sops.find((x) => x.id === Number(arg));
    const v = s.versions[0];
    const de = v.content.de;
    return `<h1>${icon('edit')} ${esc(s.code)} bearbeiten</h1><p class="note">Speichern erzeugt eine neue Entwurfsversion. Erst „Freigeben“ macht sie für Mitarbeiter sichtbar. Übersetzungen anderer Sprachen bleiben aus der Vorversion erhalten und gelten als ungeprüft.</p>
      <form data-submit="sop-save" data-id="${s.id}" class="form"><label>Titel (DE)<input name="title" value="${esc(de.title)}" required></label>
      ${[0, 1, 2, 3, 4, 5].map((k) => `<div class="grid2"><label>Schritt ${k + 1}<textarea name="step${k}" rows="2">${esc(de.steps[k]?.text || '')}</textarea></label>
        <label>Symbol<select name="icon${k}">${['check', 'hands', 'spray', 'clean', 'warn', 'shield', 'lock', 'book', 'power', 'snow', 'fryer', 'thermo', 'trash', 'run'].map((i) => `<option ${de.steps[k]?.icon === i ? 'selected' : ''}>${i}</option>`).join('')}</select></label></div>`).join('')}
      <button class="primary">Neue Version speichern</button></form>`;
  }
  return `<h1>${icon('book')} Anleitungen (SOP)</h1>${sops.map((s) => { const appr = s.versions.find((v) => v.status === 'approved'); const draft = s.versions.find((v) => v.status === 'draft');
    return `<section class="card"><h2>${icon(s.icon)} ${esc(s.versions[0].content.de.title)} <small>${esc(s.code)}</small></h2>
      <p>Freigegeben: ${appr ? 'Version ' + appr.version_no + ' (' + fmtTime(appr.approved_at) + ')' : '<b>keine</b>'} · Entwurf: ${draft ? 'Version ' + draft.version_no : '–'}</p>
      <p>Fachliche/Hersteller-Prüfung: <select data-change="sop-review" data-id="${s.id}">${[['pending', 'ausstehend (Entwurf – nicht zur Anwendung)'], ['verified', 'geprüft'], ['not_required', 'nicht nötig']].map(([k, l]) => `<option value="${k}" ${s.safety_review === k ? 'selected' : ''}>${l}</option>`).join('')}</select></p>
      <div class="row"><a class="secondary" href="#/manage/sops/${s.id}">${icon('edit')} Bearbeiten</a>${draft ? `<button class="primary" data-action="sop-publish" data-id="${s.id}" data-version="${draft.version_no}">Version ${draft.version_no} freigeben</button>` : ''}</div></section>`; }).join('')}`;
}

async function mUsers() {
  const [users, branches, settings] = await Promise.all([get('/api/admin/users'), get('/api/branches'), get('/api/admin/settings')]);
  const bn = Object.fromEntries(branches.map((b) => [b.id, b.name]));
  return `<h1>${icon('user')} Benutzer & Filialen</h1><table class="tbl"><thead><tr><th>Name</th><th>Benutzer</th><th>Rollen</th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.display_name)}</td><td>${esc(u.username)}</td><td>${u.is_admin ? 'Admin' : u.memberships.map((m) => `${esc(bn[m.branch_id])}: ${esc(m.role)}`).join(', ')}</td></tr>`).join('')}</tbody></table>
    <h2>Neuer Benutzer</h2><form data-submit="user-new" class="form"><div class="grid2"><label>Anzeigename<input name="display_name" required></label><label>Benutzername<input name="username" required pattern="[A-Za-z0-9._-]{3,40}"></label>
      <label>Startpasswort (min. 10 Zeichen)<input name="password" type="password" required minlength="10" autocomplete="new-password"></label>
      <label>Filiale<select name="branch_id">${branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
      <label>Rolle<select name="role"><option value="employee">Mitarbeiter</option><option value="shift_lead">Schichtführer</option><option value="trainer">Trainer</option><option value="manager">Filialleitung</option></select></label></div>
      <button class="primary">${icon('add')} Anlegen</button></form>
    <h2>Datenschutz</h2><form data-submit="settings" class="form"><label>Fotos aufbewahren (Tage, 30–3650)<input name="photo_retention_days" type="number" min="30" max="3650" value="${esc(settings.photo_retention_days)}"></label><button class="primary">Speichern</button></form>
    <h2>Neue Filiale</h2><form data-submit="branch-new" class="form"><div class="grid2"><label>Kürzel<input name="code" required pattern="[a-z0-9-]{2,30}"></label><label>Name<input name="name" required></label></div><button class="primary">${icon('add')} Anlegen</button></form>`;
}

// --- Router ----------------------------------------------------------------------------
async function route() {
  renderSeq++;
  if (!S.me) return viewStart();
  if (S.me.must_change_password) return viewPassword();
  const [, a, b, c, d] = (location.hash || '#/shift').split('/');
  if (!S.me.branches.some((x) => x.id === S.branch)) { S.branch = S.me.branches[0]?.id; localStorage.setItem('fh_branch', S.branch); }
  if (!S.branch) return shell('<section class="card">Keiner Filiale zugeordnet. Bitte Betreiber kontaktieren.</section>', { tabs: false });
  switch (a) {
    case 'learn': return b ? viewCourse(b) : viewLearn();
    case 'exam': return viewExam(b);
    case 'timer': return viewTimer();
    case 'inventory': return viewInventory();
    case 'daily': return viewDaily(b);
    case 'pest': return viewPest();
    case 'handbook': return viewHandbook();
    case 'marinade': return viewMarinade();
    case 'more': return viewMore();
    case 'welcome': return viewWelcome();
    case 'controls': return viewControls();
    case 'control': return viewControl(b);
    case 'train': return b ? viewTrainModule(b) : viewTrain();
    case 'texam': return viewTrainExam(b);
    case 'help': return viewHelp();
    case 'cleaning': return viewCleaning();
    case 'task': return viewTask(b);
    case 'goods': return viewGoods();
    case 'oil': return viewOil();
    case 'problem': return viewProblem(b);
    case 'sop': return viewSop(b);
    case 'manage': return viewManage(b, c ? (d ? `${c}/${d}` : c) : undefined);
    default: return viewShift();
  }
}

async function loadMe() {
  try { S.me = await get('/api/me'); } catch { S.me = null; }
  if (S.me && S.me.lang && !localStorage.getItem('fh_lang')) setLang(S.me.lang);
}

// --- Ereignisse ----------------------------------------------------------------------
document.addEventListener('click', async (ev) => {
  if (ev.target.closest('a, button, label.photo-btn')) S.flash = null;
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const A = el.dataset.action;
  if (el.tagName === 'BUTTON' && el.closest('form') && el.type === 'submit') return;
  ev.preventDefault();
  try {
    if (A === 'set-lang') { setLang(el.dataset.lang); return route(); }
    if (A === 'demo') { await post('/api/demo/session', { persona: el.dataset.persona }); await loadMe(); S.branch = S.me.branches[0]?.id; localStorage.setItem('fh_branch', S.branch); location.hash = el.dataset.persona.startsWith('employee') ? '#/shift' : '#/manage/dashboard'; return route(); }
    if (A === 'logout') { await post('/api/logout'); S.me = null; location.hash = ''; return route(); }
    if (A === 'set-shift') { S.shift = el.dataset.shift; localStorage.setItem('fh_shift', S.shift); S.photo = null; return route(); }
    if (A === 'speak') return speak(el.dataset.text);
    if (A === 'back') return history.back();
    if (A === 'complete') { el.disabled = true; return completeTask(el.dataset.id); }
    if (A === 'learn-step') { await post(`/api/courses/${el.dataset.id}/progress`, { lang: el.dataset.lang, step: Number(el.dataset.step) }); return route(); }
    if (A === 'camera-scan') return startCameraScan();
    if (A === 'open-link') { if (confirmLink(el.dataset.url)) window.open(el.dataset.url, '_blank', 'noopener,noreferrer'); return; }
    if (A === 'print') return window.print();
    if (A === 'tpl-move') { await post(`/api/templates/${el.dataset.id}/move`, { dir: el.dataset.dir }); return route(); }
    if (A === 'tpl-photo') { await api('PATCH', `/api/templates/${el.dataset.id}`, { requires_photo: el.dataset.val === '1' }); return route(); }
    if (A === 'note-read') { await post(`/api/notifications/${el.dataset.id}/read`); return route(); }
    if (A === 'train-start') { const r = await post(`/api/train/modules/${el.dataset.id}/start`, { branch: S.branch, lang: S.lang }); location.hash = `#/texam/${r.attempt_id}`; return; }
    if (A === 'staff-reset') { const r = await post(`/api/staff/${el.dataset.id}/reset`); S.lastInvite = { name: el.dataset.name, ...r }; S.flash = { type: 'ok', text: 'Neuer Code erstellt – altes Passwort ist ungültig.' }; return route(); }
    if (A === 'staff-active') { await post(`/api/staff/${el.dataset.id}/active`, { active: el.dataset.val === '1' }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (A === 'presence') { await post('/api/presence', { branch: S.branch, shift: S.shift }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (A === 'task-start') { await post(`/api/tasks/${el.dataset.id}/start`); return route(); }
    if (A === 'clean-log') { await post('/api/cleaning/log', { branch: S.branch, area: el.dataset.area }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (A === 'presence-set') { await post('/api/presence', { branch: S.branch, shift: el.dataset.shift, user_id: Number(el.dataset.user), status: el.dataset.status }); S.flash = { type: 'ok', text: 'Besetzung geändert – Aufgaben neu verteilt' }; return route(); }
    if (A === 'task-return') { const note = document.getElementById('return-' + el.dataset.id)?.value; await post(`/api/tasks/${el.dataset.id}/return`, { note }); S.flash = { type: 'ok', text: 'Zur Nacharbeit zurückgegeben' }; return route(); }
    if (A === 'onboarding-confirm') { await post('/api/onboarding/confirm', { branch: S.branch }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (A === 'tpl-role') { await api('PATCH', `/api/templates/${el.dataset.id}`, { role: el.dataset.val }); return route(); }
    if (A === 'tpl-active') { await api('PATCH', `/api/templates/${el.dataset.id}`, { active: el.dataset.val === '1' }); return route(); }
    if (A === 'signoff') { await post('/api/signoffs', { branch: S.branch, user_id: Number(el.dataset.user), course_id: Number(el.dataset.course) }); S.flash = { type: 'ok', text: 'Praktische Freigabe gespeichert' }; return route(); }
    if (A === 'timer-start') { await post('/api/timers', { branch: S.branch, product_id: Number(el.dataset.id), kind: el.dataset.kind }); return route(); }
    if (A === 'timer-end') { await post(`/api/timers/${el.dataset.id}/end`, { action: el.dataset.end }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (A === 'plan-remove') { planDraft.list = planDraft.list.filter((a) => !(a.station_id === Number(el.dataset.station) && a.user_id === Number(el.dataset.user))); S.planLocal = true; return route(); }
    if (A === 'plan-save') { await api('PUT', '/api/positions', { branch: S.branch, date: el.dataset.date, shift: el.dataset.shift, assignments: planDraft.list }); planDraft = null; S.flash = { type: 'ok', text: 'Positionsplan gespeichert' }; return route(); }
    if (A === 'sop-publish') { await post(`/api/admin/sops/${el.dataset.id}/publish`, { version_no: Number(el.dataset.version) }); S.flash = { type: 'ok', text: 'Freigegeben' }; return route(); }
  } catch (e) { showError(e); }
});

// Link-Bestätigung ohne Browser-Dialog: zweiter Klick innerhalb von 5 s öffnet
let linkArmed = null;
function confirmLink(url) {
  if (linkArmed === url) { linkArmed = null; return true; }
  linkArmed = url; S.flash = { type: 'ok', text: `Noch einmal tippen, um ${new URL(url).hostname} zu öffnen.` };
  setTimeout(() => { linkArmed = null; }, 5000);
  route();
  return false;
}

document.addEventListener('change', async (ev) => {
  const el = ev.target.closest('[data-change]');
  if (!el) return;
  const C = el.dataset.change;
  try {
    if (C === 'lang') { setLang(el.value); return route(); }
    if (C === 'branch') { S.branch = Number(el.value); localStorage.setItem('fh_branch', S.branch); return route(); }
    if (C === 'ctl-assign') { await post(`/api/controls/runs/${el.dataset.id}/assign`, { user_id: Number(el.value) }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (C === 'item-rhythm') { await api('PUT', `/api/items/${el.dataset.id}/rhythm`, { branch: S.branch, rhythm: el.value }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (C === 'staff-role') {
      const row = el.closest('[data-user]');
      const roles = [...row.querySelectorAll('input[data-change=staff-role]:checked')].map((x) => x.value);
      await api('PUT', `/api/staff/${row.dataset.user}/roles`, { branch: S.branch, roles }); S.flash = { type: 'ok', text: tr('saved') }; return route();
    }
    if (C === 'tpl-agent') { await api('PATCH', `/api/templates/${el.dataset.id}`, { cleaning_agent: el.value }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (C === 'task-assign') { await post(`/api/tasks/${el.dataset.id}/assign`, { user_id: el.value ? Number(el.value) : null }); S.flash = { type: 'ok', text: 'Zuständigkeit geändert' }; return route(); }
    if (C === 'marinade-recipe') { marinadeSel.recipe = el.value; return route(); }
    if (C === 'marinade-kg') { marinadeSel.kg = el.value; marinadeSel.meat = el.form?.meat_item_id?.value; lastBatch = null; return route(); }
    if (C === 'observe-station') { observeSel.station = el.value; return route(); }
    if (C === 'tpl-station') { await api('PATCH', `/api/templates/${el.dataset.id}`, { station_id: el.value || null }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (C === 'sop-review') { await api('PATCH', `/api/admin/sops/${el.dataset.id}`, { safety_review: el.value }); S.flash = { type: 'ok', text: tr('saved') }; return route(); }
    if (C === 'photo') {
      const f = el.files?.[0];
      if (!f) return;
      const label = el.closest('.photo-field');
      label?.classList.add('busy');
      const purpose = el.dataset.purpose;
      const apiPurpose = purpose.startsWith('oil-') ? 'oil' : purpose;
      const r = await uploadPhoto(f, apiPurpose);
      S.photo = { id: r.id, purpose, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null };
      label?.classList.remove('busy'); label?.classList.add('ready');
      const span = label?.querySelector('.photo-btn span'); if (span) span.textContent = tr('photo_ok');
      if (S.photo.preview && label && !label.querySelector('img')) { const img = document.createElement('img'); img.className = 'thumb'; img.src = S.photo.preview; img.alt = ''; label.appendChild(img); }
    }
  } catch (e) { showError(e); }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  const kind = form.dataset.submit;
  if (!kind) return;
  ev.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  const submitter = ev.submitter;
  const btns = form.querySelectorAll('button');
  btns.forEach((b) => (b.disabled = true));
  const hashBefore = location.hash;
  try {
    switch (kind) {
      case 'login': await post('/api/login', fd); await loadMe(); location.hash = '#/shift'; break;
      case 'redeem':
        if (fd.password !== fd.password2) throw new ApiError(400, { message: tr('passwords_differ') });
        await post('/api/invite/redeem', { code: fd.code, password: fd.password }); await loadMe(); location.hash = '#/welcome'; break;
      case 'change-password':
        if (fd.new_password !== fd.new_password2) throw new ApiError(400, { message: tr('passwords_differ') });
        await post('/api/password', { old_password: fd.old_password, new_password: fd.new_password }); await loadMe(); S.flash = { type: 'ok', text: tr('saved') }; location.hash = '#/welcome'; break;
      case 'certificate':
        await post('/api/certificates', { branch: S.branch, type: fd.type, issued_on: fd.issued_on, valid_until: fd.valid_until, media_id: S.photo?.purpose === 'certificate' ? S.photo.id : undefined });
        S.photo = null; S.flash = { type: 'ok', text: 'Nachweis gesendet – die Leitung prüft ihn.' }; break;
      case 'staff-new': {
        const r = await post('/api/staff', { branch: S.branch, username: fd.username, display_name: fd.display_name, role: fd.role });
        S.lastInvite = { name: fd.display_name, ...r }; S.flash = { type: 'ok', text: 'Konto angelegt – Einladungscode weitergeben.' }; break;
      }
      case 'cert-review': await post(`/api/certificates/${form.dataset.id}/review`, { status: submitter?.value, note: fd.note }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'cert-followup': await post('/api/certificates/followup', { branch: S.branch, user_id: Number(form.dataset.user), issued_on: fd.issued_on }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'cert-links': await api('PUT', '/api/admin/cert-links', { ifsg43: { url: fd.ifsg_url, text: fd.ifsg_text }, metro_hygiene: { url: fd.metro_url, text: fd.metro_text } }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'problem': {
        const body = { description: fd.description, media_id: S.photo?.purpose === 'problem' ? S.photo.id : undefined };
        if (form.dataset.task) await post(`/api/tasks/${form.dataset.task}/problem`, body); else await post('/api/problems', { ...body, branch: S.branch });
        S.photo = null; S.flash = { type: 'ok', text: tr('problem_sent') }; location.hash = '#/shift'; break;
      }
      case 'exam': {
        const id = form.dataset.id;
        const qsList = (await get(`/api/courses/${id}/exam?lang=${form.dataset.lang}`)).questions;
        const answers = qsList.map((q) => Number(fd['q' + q.index]));
        const r = await post(`/api/courses/${id}/exam`, { branch: S.branch, lang: form.dataset.lang, answers });
        return viewExamResult(id, r, qsList);
      }
      case 'control': {
        const r = await get(`/api/controls/runs/${form.dataset.id}`);
        const lines = r.items.map((i) => ({ item_id: i.id, qty: fd['qty_' + i.id], marinated_at: fd['mat_' + i.id] || '' }));
        const res = await post(`/api/controls/runs/${form.dataset.id}`, { lines, temperature: fd.temperature, media_id: S.photo?.purpose === 'evidence' ? S.photo.id : undefined });
        S.photo = null;
        S.flash = { type: res.below?.length ? 'warn' : 'ok', text: res.below?.length ? `${tr('saved')} · ${tr('below_min')}: ${res.below.join(', ')}` : tr('saved') };
        location.hash = '#/controls'; return;
      }
      case 'ctl-list': {
        await api('PUT', `/api/controls/lists/${form.dataset.id}`, { schedule: fd.schedule, weekday: fd.weekday, interval_days: fd.interval_days, start_date: fd.start_date, due_times: fd.due_times, photo_required: !!fd.photo_required, active: !!fd.active });
        S.flash = { type: 'ok', text: tr('saved') }; break;
      }
      case 'ctl-item': await api('PUT', `/api/controls/items/${form.dataset.id}`, { unit: fd.unit, min_qty: fd.min_qty }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'ctl-item-new': await post(`/api/controls/lists/${form.dataset.id}/items`, { name: fd.name, unit: fd.unit, min_qty: fd.min_qty }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'ctl-review': await post(`/api/controls/runs/${form.dataset.id}/review`, { ok: submitter?.value !== 'rework', note: fd.note }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'ctl-settings': await api('PUT', '/api/controls/settings', { branch: S.branch, use_within_hours: fd.use_within_hours, source: fd.source }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'train-exam': {
        const n = form.querySelectorAll('fieldset').length;
        const answers = [...Array(n)].map((_, i) => Number(fd['q' + i]));
        const r = await post(`/api/train/attempts/${form.dataset.id}/submit`, { answers, lang: S.lang });
        return viewTrainResult(form.dataset.module, r);
      }
      case 'help': S.helpQ = fd.q; return route();
      case 'train-signoff': await post(`/api/train/modules/${form.dataset.module}/signoff`, { branch: S.branch, user_id: Number(form.dataset.user), note: fd.note }); S.flash = { type: 'ok', text: 'Praktisch freigegeben – Zertifikat erstellt.' }; break;
      case 'train-module': {
        const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
        await api('PUT', `/api/train/modules/${form.dataset.id}`, { steps: { de: lines(fd.steps_de), en: lines(fd.steps_en), ar: lines(fd.steps_ar) }, video_url: fd.video_url, open_points: lines(fd.open_points),
          practical_required: !!fd.practical_required, reviewed_langs: [fd.rev_en && 'en', fd.rev_ar && 'ar'].filter(Boolean) });
        S.flash = { type: 'ok', text: tr('saved') }; break;
      }
      case 'train-question': {
        const content = {};
        for (const L of ['de', 'en', 'ar']) if ((fd[L + '_q'] || '').trim()) content[L] = { q: fd[L + '_q'], options: [fd[L + '_a'], fd[L + '_b'], fd[L + '_c']].filter((x) => (x || '').trim()), explain: fd[L + '_x'] };
        const body = { content, safety: !!fd.safety, status: fd.status };
        if (form.dataset.id) await api('PUT', `/api/train/questions/${form.dataset.id}`, body); else await post(`/api/train/modules/${form.dataset.module}/questions`, body);
        S.flash = { type: 'ok', text: tr('saved') }; break;
      }
      case 'scan': await doScan(fd.code); return;
      case 'receipt': {
        await post('/api/goods/receipts', { branch: S.branch, item_id: Number(fd.item_id), quantity: fd.quantity, batch: fd.batch, best_before: fd.best_before, temperature: fd.temperature,
          condition_ok: !!fd.condition_ok, decision: submitter?.value || 'accepted', reject_reason: fd.reject_reason, code: scanState?.raw,
          media_id: S.photo?.purpose === 'goods' ? S.photo.id : undefined });
        S.photo = null; scanState = null; S.flash = { type: 'ok', text: tr('saved') }; break;
      }
      case 'oil': {
        const purpose = 'oil-' + form.dataset.id;
        const r = await post(`/api/oil/${form.dataset.id}/event`, { type: submitter?.value || 'tpm', tpm: fd.tpm, temperature: fd.temperature, quality_ok: fd.quality_ok ?? '', media_id: S.photo?.purpose === purpose ? S.photo.id : undefined });
        S.photo = null; S.flash = r.status.blocked ? { type: 'error', text: tr('blocked_fryer') } : { type: 'ok', text: tr('saved') }; break;
      }
      case 'oil-change': {
        const purpose = 'oilchange-' + form.dataset.id;
        await post(`/api/oil/${form.dataset.id}/event`, { type: 'change', reason: fd.reason, quantity_l: fd.quantity_l, tpm: fd.tpm, temperature: fd.temperature, media_id: S.photo?.purpose === purpose ? S.photo.id : undefined });
        S.photo = null; S.flash = { type: 'ok', text: tr('saved') }; break;
      }
      case 'oil-import': {
        const rows = String(fd.csv || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[;,\t]/).map((x) => x.trim()))
          .filter((c) => c.length >= 3 && !/serien|serial/i.test(c[0])).map((c) => ({ device_serial: c[0], measured_at: c[1], tpm: c[2], temperature: c[3] ?? '' }));
        const r = await post('/api/oil/import', { branch: S.branch, rows, source: fd.test ? 'test' : 'import' });
        S.flash = { type: 'ok', text: `Import: ${r.imported} neu, ${r.duplicates} doppelt, ${r.invalid} ungültig${r.unknown_devices.length ? ', unbekannte Geräte: ' + r.unknown_devices.join(', ') : ''}${r.blocked.length ? ' · GESPERRT: ' + r.blocked.join(', ') : ''}` };
        break;
      }
      case 'count': { const r = await post('/api/stock/count', { branch: S.branch, item_id: Number(form.dataset.item), counted: fd.counted }); S.flash = { type: 'ok', text: `Inventur gebucht (Differenz ${r.diff})` }; break; }
      case 'waste': await post('/api/stock/movement', { branch: S.branch, item_id: Number(form.dataset.item), type: 'waste', quantity: fd.quantity, note: fd.note }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'problem-action': await post(`/api/problems/${form.dataset.id}/${submitter?.value === 'rework' ? 'rework' : 'resolve'}`, { note: fd.note }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'approve-shift': await post('/api/shifts/approve', { branch: S.branch, shift: form.dataset.shift, date: form.dataset.date, note: fd.note }); S.flash = { type: 'ok', text: 'Schicht freigegeben' }; break;
      case 'tpl-new': await post('/api/templates', { branch: S.branch, shift: fd.shift, title_de: fd.title_de, hint_de: fd.hint_de, requires_photo: !!fd.requires_photo, station_id: fd.station_id || null, category: fd.category, interval_days: fd.interval_days }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'assign-code': await post(`/api/goods/unknown/${form.dataset.id}/assign`, { item_id: Number(fd.item_id) }); S.flash = { type: 'ok', text: 'Code zugeordnet' }; break;
      case 'item-new': await post('/api/items', { ...fd, branch: S.branch, needs_temperature: !!fd.needs_temperature }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'receipt-doc': await post('/api/goods/documents', { branch: S.branch, receipt_no: fd.receipt_no, media_id: S.photo?.purpose === 'receipt' ? S.photo.id : undefined }); S.photo = null; S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'oil-limits': await api('PATCH', `/api/oil/${form.dataset.id}`, fd); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'sop-save': {
        const steps = [0, 1, 2, 3, 4, 5].map((k) => ({ text: fd['step' + k], icon: fd['icon' + k] })).filter((s) => s.text && s.text.trim());
        const sops = await get('/api/admin/sops');
        const prev = sops.find((x) => x.id === Number(form.dataset.id)).versions[0].content;
        await post(`/api/admin/sops/${form.dataset.id}/versions`, { content: { ...prev, de: { title: fd.title, steps } }, reviewed_langs: ['de'] });
        S.flash = { type: 'ok', text: 'Neue Entwurfsversion gespeichert – jetzt freigeben.' }; location.hash = '#/manage/sops'; break;
      }
      case 'user-new': await post('/api/admin/users', { username: fd.username, display_name: fd.display_name, password: fd.password, memberships: [{ branch_id: Number(fd.branch_id), role: fd.role }] }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'inventory': {
        const lines = Object.entries(fd).filter(([k, v]) => k.startsWith('c') && v !== '').map(([k, v]) => ({ item_id: Number(k.slice(1)), counted: v }));
        await api('PUT', '/api/inventory/lines', { branch: S.branch, lines });
        if (submitter?.value === 'submit') { const r = await post('/api/inventory/submit', { branch: S.branch }); S.flash = { type: 'ok', text: `Inventur ${r.week} abgeschlossen · ${r.diffs} Abweichungen gebucht` }; }
        else S.flash = { type: 'ok', text: tr('saved') };
        break;
      }
      case 'daily': {
        const ids = [...new Set(Object.keys(fd).filter((k) => /^[cmu]\d+$/.test(k)).map((k) => Number(k.slice(1))))];
        const lines = ids.filter((id) => fd['c' + id] !== '' && fd['c' + id] != null).map((id) => ({ item_id: id, counted: fd['c' + id], marinated: fd['m' + id] ?? '', unusable: fd['u' + id] ?? '' }));
        const r = await post('/api/daily', { branch: S.branch, shift: form.dataset.shift, lines, submit: submitter?.value === 'submit' });
        S.flash = r.count_id && r.on_time != null ? { type: r.on_time ? 'ok' : 'error', text: r.on_time ? 'Tagesinventur rechtzeitig abgegeben. Danke!' : 'Tagesinventur abgegeben – nach der Frist. Die Leitung ist informiert.' } : { type: 'ok', text: tr('saved') };
        break;
      }
      case 'pest': {
        const n = form.querySelectorAll('.pest-area').length;
        const areas = [...form.querySelectorAll('.pest-area')].map((fs, k) => ({ area: fs.querySelector('legend').textContent, finding: fd['f' + k] === '1', note: fd['n' + k], measure: fd['m' + k], done: !!fd['d' + k] }));
        void n;
        const r = await post('/api/pest', { branch: S.branch, areas, exterminator_needed: !!fd.exterminator, remarks: fd.remarks, media_id: S.photo?.purpose === 'problem' ? S.photo.id : undefined });
        S.photo = null;
        S.flash = { type: r.infestation ? 'error' : 'ok', text: r.infestation ? 'Befall gemeldet – Leitung ist informiert. Bereich schützen, nichts selbst sprühen.' : 'Kontrolle gespeichert – kein Befall.' };
        break;
      }
      case 'batch': {
        const actuals = Object.keys(fd).filter((k) => /^a\d+$/.test(k)).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))).map((k) => fd[k]);
        lastBatch = await post('/api/marinades/batches', { branch: S.branch, marinade_id: Number(fd.marinade_id), meat_item_id: Number(fd.meat_item_id), meat_kg: fd.meat_kg, actuals, note: fd.note });
        marinadeSel.kg = ''; S.flash = { type: 'ok', text: `Charge ${lastBatch.batch_code} gespeichert` };
        break;
      }
      case 'batch-rest':
        if (submitter?.value === 'discard') await post(`/api/marinades/batches/${form.dataset.id}/discard`, { reason: fd.reason });
        else await post(`/api/marinades/batches/${form.dataset.id}/rest`, { remaining_kg: fd.remaining_kg });
        S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'recipe': {
        const ingredients = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ name: fd['in' + k], per_kg: fd['ip' + k], unit: fd['iu' + k] })).filter((i) => i.name && i.name.trim());
        const body = { name: fd.name, ingredients, allergens: fd.allergens, tolerance_percent: fd.tolerance_percent, use_within_hours: fd.use_within_hours, use_source: fd.use_source };
        if (form.dataset.id) await api('PUT', `/api/admin/marinades/${form.dataset.id}`, body); else await post('/api/admin/marinades', body);
        S.flash = { type: 'ok', text: 'Rezeptur gespeichert (neue Version)' }; break;
      }
      case 'daily-settings': await api('PUT', '/api/daily/settings', { branch: S.branch, early: fd.early, late: fd.late }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'onboarding-trainer': {
        const areas = [...form.querySelectorAll('input[name=area]:checked')].map((x) => x.value);
        await post('/api/onboarding', { branch: S.branch, user_id: Number(form.dataset.user), areas }); S.flash = { type: 'ok', text: 'Einweisung eingetragen – Mitarbeiter bestätigt in „Lernen → Handbuch“.' }; break;
      }
      case 'inventory-weekday': await api('PUT', '/api/inventory/settings', { branch: S.branch, weekday: Number(fd.weekday) }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'course-settings': await api('PATCH', `/api/courses/${form.dataset.id}`, { valid_months: fd.valid_months, required: !!fd.required }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'plan-add': {
        const sid = Number(form.dataset.station), uid = Number(fd.user_id);
        planDraft.list = planDraft.list.filter((a) => !(a.station_id === sid && a.user_id === uid));
        planDraft.list.push({ station_id: sid, user_id: uid, training: !!fd.training });
        S.planLocal = true;
        break;
      }
      case 'observe': {
        const items = [...form.querySelectorAll('.checklist input[type=radio]:checked')].map((r) => ({ item_id: Number(r.name.slice(1)), ok: r.value === '1' }));
        const r = await post('/api/observations', { branch: S.branch, station_id: Number(form.dataset.station), user_id: Number(fd.user_id), results: items, note: fd.note });
        S.flash = { type: r.passed ? 'ok' : 'error', text: r.passed ? `Bestanden (${r.score}/${r.total}) – Station freigegeben. Stufe: ${levelLabel(r.level.level)}` : `Nicht bestanden (${r.score}/${r.total}${r.critical_failed ? `, ${r.critical_failed} kritisch` : ''}). Nachschulen und erneut prüfen.` };
        break;
      }
      case 'product': await api('PATCH', `/api/products/${form.dataset.id}`, fd); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'product-new': await post('/api/products', { branch: S.branch, name_de: fd.name_de, station_id: fd.station_id || null }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'settings': await api('PUT', '/api/admin/settings', { photo_retention_days: Number(fd.photo_retention_days) }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'branch-new': await post('/api/admin/branches', fd); await loadMe(); S.flash = { type: 'ok', text: tr('saved') }; break;
    }
    if (location.hash === hashBefore) route(); // sonst rendert der hashchange-Handler
    if (S.flash) window.scrollTo(0, 0); // Meldung oben sichtbar machen
  } catch (e) { showError(e); } finally { btns.forEach((b) => (b.disabled = false)); }
});

window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/shift')) S.photo = null; if (!location.hash.startsWith('#/timer')) clearInterval(timerTick); route(); });
const toggleOffline = () => { const b = document.getElementById('offline-banner'); if (b) b.hidden = navigator.onLine; };
window.addEventListener('online', toggleOffline);
window.addEventListener('offline', toggleOffline);

(async function init() {
  setLang(S.lang);
  try { S.config = await get('/api/config'); } catch { S.config = { demo: false, has_admin: true, trusted_hosts: [], notification_channels: [] }; }
  await loadMe();
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
