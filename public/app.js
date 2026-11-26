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

function shell(content, { tabs = true } = {}) {
  const demo = S.config?.demo ? `<div class="demo-banner" role="status">${esc(tr('demo_banner'))}</div>` : '';
  const off = `<div id="offline-banner" class="offline" role="alert" ${navigator.onLine ? 'hidden' : ''}>${esc(tr('offline'))}</div>`;
  // Meldung bleibt sichtbar, bis die Person die nächste Aktion ausführt (kein Verschwinden durch Neuaufbau).
  const flash = S.flash ? `<div class="flash ${S.flash.type}" role="status">${esc(S.flash.text)}</div>` : '';
  const r = location.hash;
  const tab = (href, ic, label) => `<a href="${href}" class="tab ${r.startsWith(href) ? 'on' : ''}">${icon(ic)}<span>${esc(label)}</span></a>`;
  const nav = tabs && S.me ? `<nav class="tabs" aria-label="Navigation">
      ${tab('#/shift', 'list', tr('tab_tasks'))}${tab('#/learn', 'school', tr('tab_learn'))}${tab('#/goods', 'scan', tr('tab_goods'))}${tab('#/oil', 'oil', tr('tab_oil'))}
      ${isManager() || isTrainer() ? tab('#/manage', 'dash', tr('tab_manage')) : ''}</nav>` : '';
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
      ${['employee_halle', 'employee_leuna', 'manager_halle', 'manager_leuna', 'trainer', 'admin'].map((p) => `<button class="big-btn" data-action="demo" data-persona="${p}">${icon(p.startsWith('employee') ? 'user' : p === 'admin' ? 'settings' : p === 'trainer' ? 'school' : 'dash')}<span>${esc(tr('persona_' + p))}</span></button>`).join('')}
    </div></section>` : `<section class="card"><h2>${esc(tr('login'))}</h2>
      ${S.config.has_admin ? '' : `<p class="note">${esc(tr('no_admin_yet'))}</p>`}
      <form data-submit="login" class="form">
        <label>${esc(tr('username'))}<input name="username" autocomplete="username" required></label>
        <label>${esc(tr('password'))}<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="primary">${esc(tr('login'))}</button>
      </form></section>`;
  shell(`<div class="start">
      <div class="hero"><img src="/logo.svg" alt="" width="84" height="84"><h1>ForHuman Fried Chicken</h1><p>${esc(tr('app_name'))}</p></div>
      <section class="card"><h2>${icon('lang')} ${esc(tr('choose_lang'))}</h2><div class="lang-grid">${langs}</div></section>
      ${demo}</div>`, { tabs: false });
}

// --- Mitarbeiter: eine Aufgabe pro Bildschirm -----------------------------------------
async function viewShift() {
  const shiftBtns = ['open', 'run', 'close'].map((s) => `<button class="seg ${S.shift === s ? 'on' : ''}" data-action="set-shift" data-shift="${s}">${icon(s === 'open' ? 'sun' : s === 'run' ? 'run' : 'moon')}<span>${esc(tr('shift_' + s))}</span></button>`).join('');
  let d;
  try { d = await get(`/api/shift/next?${qs({ branch: S.branch, shift: S.shift, lang: S.lang })}`); }
  catch (e) { return shell(`<div class="segs">${shiftBtns}</div>${errorBox(e)}`); }
  const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
  const progress = `<div class="progress"><span>${d.done} ${esc(tr('of'))} ${d.total}</span><progress max="100" value="${pct}" aria-label="${pct}%"></progress></div>`;
  let body;
  const n = d.next;
  if (!n) {
    body = `<section class="card center done-card">${icon('check', 'huge ok')}<h2>${esc(tr('all_done'))}</h2>${d.problems ? `<p>${esc(tr('problem_open_wait'))}</p>` : ''}</section>`;
  } else {
    S.current = n;
    const sayText = `${n.title}. ${n.hint || ''}`;
    body = `<article class="task-card ${n.status === 'rework' ? 'rework' : ''}" data-task="${n.id}">
        ${n.status === 'rework' ? `<div class="tag warn">${icon('history')} ${esc(tr('rework'))}</div>` : `<div class="tag">${esc(tr('next_task'))}</div>`}
        <div class="task-icon">${icon(n.icon, 'huge')}</div>
        <h1 class="task-title">${esc(n.title)}</h1>
        ${n.hint ? `<p class="task-hint">${esc(n.hint)}</p>` : ''}
        ${n.measure_unit ? `<label class="value-input">${esc(tr('enter_value'))}<span><input id="value" inputmode="decimal" type="number" step="0.1" aria-label="${esc(tr('enter_value'))}"> ${esc(n.measure_unit)}</span></label>` : ''}
        ${n.requires_photo ? photoField('evidence', tr('photo_required')) : ''}
        <div class="actions">
          ${canSpeak() ? `<button class="act" data-action="speak" data-text="${esc(sayText)}">${icon('speak')}<span>${esc(tr('btn_speak'))}</span></button>` : ''}
          ${n.sop_id ? `<a class="act" href="#/sop/${n.sop_id}">${icon('book')}<span>${esc(tr('btn_guide'))}</span></a>` : ''}
          <a class="act warn" href="#/problem/${n.id}">${icon('warn')}<span>${esc(tr('btn_problem'))}</span></a>
        </div>
        <button class="done-btn" data-action="complete" data-id="${n.id}">${icon('check')}<span>${esc(tr('btn_done'))}</span></button>
      </article>`;
  }
  const blocked = d.blocked.length ? `<section class="card muted"><h3>${icon('lock')} ${esc(tr('blocked_tasks'))}</h3>
      <ul class="plain">${d.blocked.map((b) => `<li>${icon(b.icon)} ${esc(b.title)} <a href="#/learn/${b.required_course_id}">${esc(tr('tab_learn'))} →</a></li>`).join('')}</ul></section>` : '';
  shell(`<div class="segs">${shiftBtns}</div>${progress}${body}${blocked}`);
}

function photoField(purpose, label) {
  const ready = S.photo && S.photo.purpose === purpose;
  return `<div class="photo-field ${ready ? 'ready' : ''}">
      <label class="photo-btn">${icon('camera')}<span>${esc(ready ? tr('photo_ok') : label || tr('take_photo'))}</span>
      <input type="file" accept="image/*${purpose === 'receipt' ? ',application/pdf' : ''}" capture="environment" data-change="photo" data-purpose="${purpose}" hidden></label>
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
  let s;
  try { s = await get(`/api/sops/${id}?lang=${S.lang}`); } catch (e) { return shell(errorBox(e)); }
  if (!s.published) return shell(`<section class="card">${esc(tr('sop_not_published'))}</section><a class="secondary" href="#/shift">${esc(tr('back'))}</a>`);
  const all = s.steps.map((x) => x.text).join(' ');
  shell(`<section class="card sop">
      ${s.safety_review === 'pending' ? `<div class="banner danger">${icon('warn')} ${esc(tr('draft_not_for_use'))}</div>` : ''}
      ${!s.translation_reviewed ? `<div class="banner">${esc(tr('translation_unreviewed'))}</div>` : ''}
      <h1>${icon(s.icon)} ${esc(s.title)}</h1><p class="meta">${esc(s.code)} · Version ${s.version}</p>
      ${canSpeak() ? `<button class="act" data-action="speak" data-text="${esc(s.title + '. ' + all)}">${icon('speak')}<span>${esc(tr('btn_speak'))}</span></button>` : ''}
      <ol class="steps">${s.steps.map((x, i) => `<li><span class="num">${i + 1}</span><span class="step-ico">${icon(x.icon)}</span><p>${esc(x.text)}</p></li>`).join('')}</ol>
      <button class="secondary" data-action="back">${esc(tr('back'))}</button></section>`);
}

// --- Academy --------------------------------------------------------------------
async function viewLearn() {
  let list;
  try { list = await get(`/api/courses?${qs({ branch: S.branch, lang: S.lang })}`); } catch (e) { return shell(errorBox(e)); }
  shell(`<h1 class="page-title">${icon('school')} ${esc(tr('courses'))}</h1>
    <div class="course-list">${list.map((c) => {
      const state = c.ok ? `<span class="badge ok">${esc(tr('qualified'))}</span>` : c.exam && c.needsPractical ? `<span class="badge warn">${esc(tr('needs_practical'))}</span>` : `<span class="badge">${esc(tr('not_started'))}</span>`;
      return `<a class="course" href="#/learn/${c.id}">${icon(c.icon, 'big')}<div><b>${esc(c.title)}</b><small>${c.steps_done}/${c.steps} ${esc(tr('step'))} ${c.safety_critical ? '· ' + icon('shield') : ''}</small></div>${state}</a>`;
    }).join('')}</div>`);
}

async function viewCourse(id) {
  let c;
  try { c = await get(`/api/courses/${id}?${qs({ branch: S.branch, lang: S.lang })}`); } catch (e) { return shell(errorBox(e)); }
  // 1) Sprache selbst wählen (vor Beginn, jederzeit vor der Prüfung änderbar)
  const langPick = `<div class="lang-grid small">${c.langs.map((l) => `<button class="lang-btn ${l === c.lang ? 'on' : ''}" data-action="set-lang" data-lang="${l}" lang="${l}">${LANG_NAMES[l]}</button>`).join('')}</div>`;
  const i = Math.min(c.steps_done, c.steps.length - 1);
  const allDone = c.steps_done >= c.steps.length;
  const stepsHtml = c.steps.map((s, k) => `<li class="${k < c.steps_done ? 'done' : k === c.steps_done ? 'current' : 'todo'}"><span class="num">${k < c.steps_done ? icon('check') : k + 1}</span><span class="step-ico">${icon(s.icon)}</span><p>${esc(s.text)}</p></li>`).join('');
  const cur = c.steps[i];
  shell(`<section class="card course-view">
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
  let e;
  try { e = await get(`/api/courses/${id}/exam?lang=${S.lang}`); } catch (err) { return shell(errorBox(err) + `<a class="secondary" href="#/learn/${id}">${esc(tr('back'))}</a>`); }
  shell(`<section class="card exam"><h1>${icon('school')} ${esc(tr('start_exam'))}</h1>
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

// --- Wareneingang ---------------------------------------------------------------------
let scanState = null;
async function viewGoods() {
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
  shell(`<h1 class="page-title">${icon('scan')} ${esc(tr('tab_goods'))}</h1>
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

// --- Ölmanager ------------------------------------------------------------------------
async function viewOil() {
  let fryers;
  try { fryers = await get(`/api/oil?branch=${S.branch}`); } catch (e) { return shell(errorBox(e)); }
  const stateLabel = (f) => ({ ok: tr('oil_ok'), warn: tr('oil_warn'), change: tr('oil_change_now'), unknown: tr('oil_unknown') }[f.state]);
  const reason = (f) => ({ no_limit: tr('oil_no_limit'), no_measurement: tr('oil_no_measure'), not_measured_today: tr('oil_not_today') }[f.reason] || '');
  shell(`<h1 class="page-title">${icon('oil')} ${esc(tr('tab_oil'))}</h1>
    ${fryers.map((f) => `<section class="card fryer state-${f.state}">
      <h2>${icon('fryer')} ${esc(f.name)} <span class="badge ${f.state}">${esc(stateLabel(f))}</span></h2>
      <p class="meta">${esc(f.manufacturer || '')} ${esc(f.model || '')}${f.model_verified ? '' : ' · Modell nicht verifiziert'} · ${esc(f.oil_product || '')}</p>
      <p>${f.last_tpm != null ? `TPM ${f.last_tpm} % · ${fmtTime(f.last_measured_at)}` : ''} ${f.tpm_limit != null ? `· Grenzwert ${f.tpm_limit} % (${esc(f.limit_source || '')})` : ''}</p>
      ${reason(f) ? `<p class="note">${esc(reason(f))}</p>` : ''}
      <form data-submit="oil" data-id="${f.id}" class="form">
        <div class="grid2"><label>TPM %<input name="tpm" type="number" step="0.5" min="0" max="100"></label>
        <label>Notiz<input name="note"></label></div>
        ${photoField('oil-' + f.id, tr('photo_required'))}
        <div class="row wrap"><button class="primary" name="type" value="tpm">${esc(tr('tpm_measure'))}</button><button class="secondary" name="type" value="filter">${esc(tr('oil_filter'))}</button><button class="secondary" name="type" value="change">${esc(tr('oil_change'))}</button></div>
      </form>
      <details><summary>${icon('history')} Verlauf</summary><ul class="plain">${f.history.map((h) => `<li>${fmtTime(h.created_at)} · ${esc(h.type)}${h.tpm != null ? ' ' + h.tpm + ' %' : ''} · ${esc(h.by)}</li>`).join('') || '<li>–</li>'}</ul></details>
    </section>`).join('') || '<p>–</p>'}`);
}

// --- Leitung ----------------------------------------------------------------------------
function manageNav(active) {
  const items = [['dashboard', 'dash', 'Übersicht'], ['problems', 'warn', 'Probleme'], ['report', 'report', 'Schichtbericht'], ['templates', 'list', 'Aufgaben-Vorlagen'],
    ['training', 'school', 'Schulung & Freigaben'], ['stock', 'box', 'Bestand & Codes'], ['oil', 'oil', 'Öl-Grenzwerte'], ['audit', 'history', 'Protokoll']];
  if (S.me.is_admin) items.push(['sops', 'book', 'Anleitungen (SOP)'], ['users', 'user', 'Benutzer & Filialen']);
  const visible = items.filter(([k]) => isManager() || k === 'training' || k === 'dashboard');
  return `<nav class="subnav">${visible.map(([k, ic, l]) => `<a href="#/manage/${k}" class="${active === k ? 'on' : ''}">${icon(ic)} ${l}</a>`).join('')}</nav>`;
}

async function viewManage(sub = 'dashboard', arg) {
  try {
    const fn = { dashboard: mDashboard, problems: mProblems, report: mReport, templates: mTemplates, training: mTraining, stock: mStock, oil: mOil, audit: mAudit, sops: mSops, users: mUsers }[sub] || mDashboard;
    const html = await fn(arg);
    shell(`${manageNav(sub)}<div class="manage">${html}</div>`);
  } catch (e) { shell(`${manageNav(sub)}${errorBox(e)}`); }
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
      <article class="stat ${d.stock_below_min ? 'bad' : ''}"><small>Unter Mindestbestand</small><b>${d.stock_below_min}</b><span>${d.unknown_codes} unbekannte Codes</span></article>
    </div>
    <h2>${icon('oil')} Öl</h2><div class="stats">${d.oil.map((o) => `<article class="stat state-${o.state}"><small>${esc(o.name)}</small><b>${o.last_tpm ?? '–'} %</b><span>${esc({ ok: 'OK', warn: 'Prüfen', change: 'Wechsel nötig', unknown: o.reason === 'no_limit' ? 'Kein Grenzwert' : 'Keine Messung' }[o.state])}</span></article>`).join('')}</div>
    <h2>${icon('warn')} Benachrichtigungen (in der App)</h2>
    <p class="note">Externe Kanäle (E-Mail/Push): ${S.config.notification_channels.length ? esc(S.config.notification_channels.join(', ')) : 'keine konfiguriert – Meldungen erscheinen nur hier.'}</p>
    <ul class="plain">${d.notifications.map((n) => `<li>${fmtTime(n.created_at)} · ${esc(n.message)}</li>`).join('') || '<li>–</li>'}</ul>`).join('');
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
  const list = await get(`/api/templates?branch=${S.branch}`);
  const byShift = { open: [], run: [], close: [] };
  list.forEach((tp) => byShift[tp.shift].push(tp));
  return `<h1>${icon('list')} Aufgaben-Vorlagen</h1><p class="note">Reihenfolge, Foto-Pflicht und Wochentage gelten nur für diese Filiale. Grenzwerte nur mit Quelle (HACCP-Plan/Herstellerangabe).</p>
    ${Object.entries(byShift).map(([s, arr]) => `<h2>${SHIFT_DE[s]}</h2><ul class="tpl-list">${arr.map((tp) => `<li class="${tp.active ? '' : 'inactive'}">
      <span>${icon(tp.icon)} <b>${esc(tp.title.de)}</b> <small>${esc(tp.frequency)}${tp.frequency !== 'monthly' ? ' · Tage ' + esc(tp.weekdays) : ' · Tag ' + tp.month_day}${tp.measure_unit ? ' · Messwert ' + esc(tp.measure_unit) + (tp.limit_min != null || tp.limit_max != null ? ` (${tp.limit_min ?? '–'}…${tp.limit_max ?? '–'})` : ' (kein Grenzwert)') : ''}</small></span>
      <span class="tpl-actions">
        <button class="small" data-action="tpl-move" data-id="${tp.id}" data-dir="up" aria-label="nach oben">${icon('up')}</button>
        <button class="small" data-action="tpl-move" data-id="${tp.id}" data-dir="down" aria-label="nach unten">${icon('down')}</button>
        <button class="small ${tp.requires_photo ? 'on' : ''}" data-action="tpl-photo" data-id="${tp.id}" data-val="${tp.requires_photo ? 0 : 1}">${icon('camera')} ${tp.requires_photo ? 'Pflicht' : 'optional'}</button>
        <button class="small" data-action="tpl-active" data-id="${tp.id}" data-val="${tp.active ? 0 : 1}">${tp.active ? 'aktiv' : 'aus'}</button>
      </span></li>`).join('')}</ul>`).join('')}
    <h2>Neue Aufgabe</h2><form data-submit="tpl-new" class="form"><div class="grid2">
      <label>Schicht<select name="shift"><option value="open">Öffnung</option><option value="run">Betrieb</option><option value="close">Schließung</option></select></label>
      <label>Titel (kurz)<input name="title_de" required maxlength="120"></label><label>Hinweis (ein Satz)<input name="hint_de" maxlength="200"></label>
      <label class="check"><input type="checkbox" name="requires_photo"> Foto Pflicht</label></div><button class="primary">${icon('add')} Anlegen</button></form>`;
}

async function mTraining() {
  const d = await get(`/api/training?branch=${S.branch}`);
  return `<h1>${icon('school')} Schulung & praktische Freigaben</h1>
    <table class="tbl"><thead><tr><th>Mitarbeiter</th>${d.courses.map((c) => `<th>${esc(c.title)}${c.safety_critical ? ' ' + icon('shield') : ''}</th>`).join('')}</tr></thead><tbody>
    ${d.people.map((p) => `<tr><td>${esc(p.display_name)}</td>${d.courses.map((c) => { const s = p.status[c.id];
      return `<td>${s.ok ? '<span class="badge ok">qualifiziert</span>' : s.exam ? (s.needsPractical && isTrainer() ? `<button class="small primary" data-action="signoff" data-user="${p.id}" data-course="${c.id}">Praktisch freigeben</button>` : '<span class="badge warn">Praxis fehlt</span>') : '<span class="badge">Prüfung fehlt</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
    <p class="note">Praktische Freigabe nur durch Trainer nach dokumentierter Einweisung am Gerät. Eigene Freigabe ist gesperrt.</p>`;
}

async function mStock() {
  const [stock, unknown, items] = await Promise.all([get(`/api/stock?branch=${S.branch}`), get(`/api/goods/unknown?branch=${S.branch}`), get('/api/items')]);
  return `<h1>${icon('box')} Bestand & Codes</h1>${stockTable(stock, true)}
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
      <label>Quelle (Pflicht)<input name="limit_source" value="${esc(f.limit_source || '')}"></label><label>Ölprodukt<input name="oil_product" value="${esc(f.oil_product || '')}"></label></div>
      <button class="primary">Speichern</button></form>`).join('')}`;
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
      <label>Rolle<select name="role"><option value="employee">Mitarbeiter</option><option value="trainer">Trainer</option><option value="manager">Filialleitung</option></select></label></div>
      <button class="primary">${icon('add')} Anlegen</button></form>
    <h2>Datenschutz</h2><form data-submit="settings" class="form"><label>Fotos aufbewahren (Tage, 30–3650)<input name="photo_retention_days" type="number" min="30" max="3650" value="${esc(settings.photo_retention_days)}"></label><button class="primary">Speichern</button></form>
    <h2>Neue Filiale</h2><form data-submit="branch-new" class="form"><div class="grid2"><label>Kürzel<input name="code" required pattern="[a-z0-9-]{2,30}"></label><label>Name<input name="name" required></label></div><button class="primary">${icon('add')} Anlegen</button></form>`;
}

// --- Router ----------------------------------------------------------------------------
async function route() {
  if (!S.me) return viewStart();
  const [, a, b, c, d] = (location.hash || '#/shift').split('/');
  if (!S.me.branches.some((x) => x.id === S.branch)) { S.branch = S.me.branches[0]?.id; localStorage.setItem('fh_branch', S.branch); }
  if (!S.branch) return shell('<section class="card">Keiner Filiale zugeordnet. Bitte Betreiber kontaktieren.</section>', { tabs: false });
  switch (a) {
    case 'learn': return b ? viewCourse(b) : viewLearn();
    case 'exam': return viewExam(b);
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
    if (A === 'tpl-active') { await api('PATCH', `/api/templates/${el.dataset.id}`, { active: el.dataset.val === '1' }); return route(); }
    if (A === 'signoff') { await post('/api/signoffs', { branch: S.branch, user_id: Number(el.dataset.user), course_id: Number(el.dataset.course) }); S.flash = { type: 'ok', text: 'Praktische Freigabe gespeichert' }; return route(); }
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
      case 'scan': await doScan(fd.code); return;
      case 'receipt': {
        await post('/api/goods/receipts', { branch: S.branch, item_id: Number(fd.item_id), quantity: fd.quantity, batch: fd.batch, best_before: fd.best_before, temperature: fd.temperature,
          condition_ok: !!fd.condition_ok, decision: submitter?.value || 'accepted', reject_reason: fd.reject_reason, code: scanState?.raw,
          media_id: S.photo?.purpose === 'goods' ? S.photo.id : undefined });
        S.photo = null; scanState = null; S.flash = { type: 'ok', text: tr('saved') }; break;
      }
      case 'oil': {
        const purpose = 'oil-' + form.dataset.id;
        await post(`/api/oil/${form.dataset.id}/event`, { type: submitter?.value || 'tpm', tpm: fd.tpm, note: fd.note, media_id: S.photo?.purpose === purpose ? S.photo.id : undefined });
        S.photo = null; S.flash = { type: 'ok', text: tr('saved') }; break;
      }
      case 'count': { const r = await post('/api/stock/count', { branch: S.branch, item_id: Number(form.dataset.item), counted: fd.counted }); S.flash = { type: 'ok', text: `Inventur gebucht (Differenz ${r.diff})` }; break; }
      case 'waste': await post('/api/stock/movement', { branch: S.branch, item_id: Number(form.dataset.item), type: 'waste', quantity: fd.quantity, note: fd.note }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'problem-action': await post(`/api/problems/${form.dataset.id}/${submitter?.value === 'rework' ? 'rework' : 'resolve'}`, { note: fd.note }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'approve-shift': await post('/api/shifts/approve', { branch: S.branch, shift: form.dataset.shift, date: form.dataset.date, note: fd.note }); S.flash = { type: 'ok', text: 'Schicht freigegeben' }; break;
      case 'tpl-new': await post('/api/templates', { branch: S.branch, shift: fd.shift, title_de: fd.title_de, hint_de: fd.hint_de, requires_photo: !!fd.requires_photo }); S.flash = { type: 'ok', text: tr('saved') }; break;
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
      case 'settings': await api('PUT', '/api/admin/settings', { photo_retention_days: Number(fd.photo_retention_days) }); S.flash = { type: 'ok', text: tr('saved') }; break;
      case 'branch-new': await post('/api/admin/branches', fd); await loadMe(); S.flash = { type: 'ok', text: tr('saved') }; break;
    }
    if (location.hash === hashBefore) route(); // sonst rendert der hashchange-Handler
  } catch (e) { showError(e); } finally { btns.forEach((b) => (b.disabled = false)); }
});

window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/shift')) S.photo = null; route(); });
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
