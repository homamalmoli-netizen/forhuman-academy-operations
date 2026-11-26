// Ölmanager je Fritteuse:
// - Tägliche Ölprüfung (TPM, Temperatur, zulässig ja/nein). Unzulässig oder TPM ≥ freigegebener Grenzwert → Fritteuse gesperrt
//   ("keine weitere Nutzung") und sofort eine Ölwechsel-Aufgabe – unabhängig vom Kalender.
// - Nächster Wechsel = Datum des tatsächlichen letzten Wechsels + konfigurierbares Intervall (z. B. 7 Tage).
//   Vorzeitiger Wechsel setzt den Termin neu. Filtern, Nachfüllen und Messen setzen ihn NICHT zurück.
// - Messwert-Import (z. B. Berichtsexport eines Messgeräts) mit Gerätezuordnung und Duplikatschutz; Testdaten werden gekennzeichnet.
//   Keine Live-Anbindung an Herstellerdienste ohne verifizierte offizielle Schnittstelle.
import { tx, audit } from './db.js';
import { berlinDate, qualification } from './app.js';

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const eventDate = (e) => berlinDate(new Date(e.measured_at || e.created_at));

export function oilStatus(db, fryer, today = berlinDate()) {
  const last = db.prepare("SELECT * FROM oil_events WHERE fryer_id = ? AND type = 'tpm' ORDER BY COALESCE(measured_at, created_at) DESC, id DESC LIMIT 1").get(fryer.id);
  const lastChange = db.prepare("SELECT * FROM oil_events WHERE fryer_id = ? AND type = 'change' ORDER BY COALESCE(measured_at, created_at) DESC, id DESC LIMIT 1").get(fryer.id);
  const measuredToday = last && eventDate(last) === today;
  let state = 'ok', reason = 'ok';
  if (fryer.blocked) { state = 'change'; reason = 'blocked'; }
  else if (!last) { state = 'unknown'; reason = 'no_measurement'; }
  else if (fryer.tpm_limit == null && last.quality_ok == null) { state = 'unknown'; reason = 'no_limit'; }
  else if (fryer.tpm_warn != null && last.tpm != null && last.tpm >= fryer.tpm_warn) { state = 'warn'; reason = 'warn_reached'; }
  if (last && !measuredToday && state === 'ok') { state = 'warn'; reason = 'not_measured_today'; }
  const lastChangeDate = lastChange ? eventDate(lastChange) : null;
  const nextDue = lastChangeDate && fryer.change_interval_days ? addDays(lastChangeDate, fryer.change_interval_days) : null;
  const changeState = fryer.blocked ? 'now' : !nextDue ? (fryer.change_interval_days ? 'no_change_recorded' : 'no_interval') : today > nextDue ? 'overdue' : today === nextDue ? 'due' : 'ok';
  return { state, reason, blocked: !!fryer.blocked, blocked_reason: fryer.blocked_reason, last_tpm: last?.tpm ?? null, last_temperature: last?.temperature ?? null,
    last_measured_at: last ? (last.measured_at || last.created_at) : null, last_change_at: lastChange ? (lastChange.measured_at || lastChange.created_at) : null,
    next_change_due: nextDue, change_state: changeState, measured_today: !!measuredToday };
}

/** Ölwechsel-Aufgabe je Fritteuse (wird nur bei Fälligkeit oder Sperre erzeugt). */
export function ensureOilTemplates(db, branchId) {
  for (const f of db.prepare('SELECT * FROM fryers WHERE branch_id = ?').all(branchId)) {
    if (db.prepare('SELECT 1 FROM task_templates WHERE fryer_id = ?').get(f.id)) continue;
    const pos = (db.prepare("SELECT MAX(position) m FROM task_templates WHERE branch_id = ? AND shift = 'close'").get(branchId).m || 0) + 10;
    db.prepare(`INSERT INTO task_templates (branch_id, shift, position, category, icon, title, hint, requires_photo, required_course_id, action, fryer_id, carry_over)
      VALUES (?, 'close', ?, 'equipment', 'oil', ?, ?, 0, ?, 'oil_change', ?, 1)`)
      .run(branchId, pos, JSON.stringify({ de: `Ölwechsel: ${f.name}`, en: `Oil change: ${f.name}`, ar: `تغيير الزيت: ${f.name}`, tr: `Yağ değişimi: ${f.name}` }),
        JSON.stringify({ de: 'Im Ölmanager als Wechsel eintragen. Nur nach Herstelleranleitung.', en: 'Record as change in the oil manager. Only as per manufacturer manual.',
          ar: 'سجّله كتغيير في إدارة الزيت. فقط حسب دليل الشركة المصنّعة.', tr: 'Yağ yöneticisine değişim olarak gir. Sadece üretici kılavuzuna göre.' }), f.course_id, f.id);
  }
}

/** Liefert true, wenn die Ölwechsel-Aufgabe dieser Fritteuse heute erzeugt werden soll. */
export function oilChangeDue(db, fryerId, today) {
  const f = db.prepare('SELECT * FROM fryers WHERE id = ?').get(fryerId);
  if (!f) return false;
  const st = oilStatus(db, f, today);
  return st.change_state === 'now' || st.change_state === 'due' || st.change_state === 'overdue';
}

function blockFryer(db, f, reason, userId, mediaId, notify) {
  if (f.blocked) return;
  db.prepare('UPDATE fryers SET blocked = 1, blocked_reason = ? WHERE id = ?').run(reason, f.id);
  db.prepare("INSERT INTO problems (branch_id, source, description, media_id, reported_by) VALUES (?, 'oil', ?, ?, ?)").run(f.branch_id, `Fritteuse ${f.name} gesperrt: ${reason}. Sofort Öl wechseln, nicht weiter benutzen.`, mediaId ?? null, userId);
  notify(db, f.branch_id, 'oil', `Fritteuse ${f.name} gesperrt – Ölwechsel sofort nötig`, `fryer:${f.id}`);
  // sofortige Wechsel-Aufgabe für heute
  const t = db.prepare('SELECT * FROM task_templates WHERE fryer_id = ?').get(f.id);
  if (t) db.prepare('INSERT OR IGNORE INTO task_occurrences (template_id, branch_id, shift, work_date, position) VALUES (?,?,?,?,?)').run(t.id, f.branch_id, t.shift, berlinDate(), t.position);
}

/** Bewertet eine Messung: unzulässig oder Grenzwert erreicht → sperren. */
function evaluateMeasurement(db, f, ev, userId, notify) {
  if (ev.quality_ok === 0) return blockFryer(db, f, 'Ölqualität bei der Prüfung als unzulässig bewertet', userId, ev.media_id, notify);
  if (ev.tpm != null && f.tpm_limit != null && ev.tpm >= f.tpm_limit) return blockFryer(db, f, `TPM ${ev.tpm} % ≥ freigegebener Grenzwert ${f.tpm_limit} %`, userId, ev.media_id, notify);
}

export function registerOil({ route, db, needUser, needBranch, HttpError, bad, notFound, notify }) {
  route('GET', '/api/oil', (ctx) => {
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    return db.prepare('SELECT * FROM fryers WHERE branch_id = ? ORDER BY name').all(branchId).map((f) => ({
      ...f, model_verified: !!f.model_verified, ...oilStatus(db, f),
      history: db.prepare(`SELECT e.id, e.type, e.tpm, e.temperature, e.quality_ok, e.reason, e.quantity_l, e.source, e.note, e.media_id,
          COALESCE(e.measured_at, e.created_at) AS at, u.display_name AS by FROM oil_events e JOIN users u ON u.id = e.created_by
        WHERE fryer_id = ? ORDER BY COALESCE(e.measured_at, e.created_at) DESC, e.id DESC LIMIT 20`).all(f.id),
    }));
  });

  route('POST', '/api/oil/:id/event', (ctx) => {
    const u = needUser(ctx);
    const f = db.prepare('SELECT * FROM fryers WHERE id = ?').get(Number(ctx.params.id));
    if (!f) throw notFound();
    const branchId = needBranch(ctx, f.branch_id);
    if (f.course_id && !qualification(db, u.id, f.course_id, branchId).ok) throw new HttpError(403, 'not_qualified', 'Schulung oder praktische Freigabe für diese Fritteuse fehlt');
    const b = ctx.body;
    const type = b.type;
    if (!['tpm', 'filter', 'topup', 'change'].includes(type)) throw bad('type');
    if (f.blocked && type !== 'change') throw new HttpError(409, 'blocked', 'Fritteuse ist gesperrt – erst Öl wechseln');
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const tpm = num(b.tpm), temperature = num(b.temperature), quantity = num(b.quantity_l);
    if (tpm != null && !(tpm >= 0 && tpm <= 100)) throw bad('tpm', 'TPM-Wert 0–100 %');
    if (temperature != null && !(temperature >= -20 && temperature <= 300)) throw bad('temperature', 'Temperatur prüfen');
    if (quantity != null && !(quantity > 0 && quantity <= 200)) throw bad('quantity_l', 'Menge in Litern prüfen');
    const qualityOk = b.quality_ok === undefined || b.quality_ok === null || b.quality_ok === '' ? null : (b.quality_ok === true || b.quality_ok === '1' || b.quality_ok === 1 ? 1 : 0);
    if (type === 'tpm' && tpm == null && qualityOk == null) throw bad('tpm', 'TPM-Wert eingeben oder Qualität bewerten');
    let media = null;
    if (b.media_id != null) {
      const m = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(b.media_id));
      if (!m || m.branch_id !== branchId) throw bad('media', 'Foto ungültig');
      media = m.id;
    }
    if (type === 'tpm' && !media) throw bad('photo_required', 'Foto vom Messgerät ist Pflicht');
    let reason = null;
    if (type === 'change') {
      reason = f.blocked ? 'quality' : b.reason;
      if (!['planned', 'early', 'quality'].includes(reason)) throw bad('reason', 'Grund wählen: planmäßig, vorzeitig oder Qualität');
    }
    return tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO oil_events (fryer_id, branch_id, type, tpm, temperature, quality_ok, reason, quantity_l, media_id, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(f.id, branchId, type, tpm, temperature, type === 'tpm' ? qualityOk : null, reason, quantity, media, String(b.note || '').slice(0, 300) || null, u.id).lastInsertRowid);
      if (type === 'tpm') evaluateMeasurement(db, f, { tpm, quality_ok: qualityOk, media_id: media }, u.id, notify);
      if (type === 'change') {
        db.prepare('UPDATE fryers SET blocked = 0, blocked_reason = NULL WHERE id = ?').run(f.id);
        // offene Ölwechsel-Aufgaben dieser Fritteuse sind damit erledigt
        db.prepare(`UPDATE task_occurrences SET status = 'done', completed_by = ?, completed_at = ?, note = 'Ölwechsel im Ölmanager dokumentiert'
          WHERE status IN ('open','rework') AND template_id IN (SELECT id FROM task_templates WHERE fryer_id = ?)`).run(u.id, new Date().toISOString(), f.id);
      }
      audit(db, { actor: u.id, branch: branchId, action: 'oil_' + type, entity: 'fryer', id: f.id, payload: { event: id, tpm, temperature, quality_ok: qualityOk, reason, quantity } });
      return { id, status: oilStatus(db, db.prepare('SELECT * FROM fryers WHERE id = ?').get(f.id)) };
    });
  });

  route('PATCH', '/api/oil/:id', (ctx) => {
    const u = needUser(ctx);
    const f = db.prepare('SELECT * FROM fryers WHERE id = ?').get(Number(ctx.params.id));
    if (!f) throw notFound();
    const branchId = needBranch(ctx, f.branch_id, 'manager', 'admin');
    const b = ctx.body;
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const limit = b.tpm_limit !== undefined ? num(b.tpm_limit) : f.tpm_limit;
    const warn = b.tpm_warn !== undefined ? num(b.tpm_warn) : f.tpm_warn;
    const source = b.limit_source !== undefined ? String(b.limit_source || '').trim() : f.limit_source;
    const interval = b.change_interval_days !== undefined ? num(b.change_interval_days) : f.change_interval_days;
    const serial = b.device_serial !== undefined ? String(b.device_serial || '').trim().slice(0, 60) || null : f.device_serial;
    if ((limit != null || warn != null) && !source) throw bad('limit_source', 'Quelle angeben (Herstellerangabe / HACCP-Plan)');
    if ([limit, warn].some((v) => v != null && (!Number.isFinite(v) || v <= 0 || v > 100))) throw bad('tpm', 'Wert 0–100 %');
    if (limit != null && warn != null && warn >= limit) throw bad('tpm_warn', 'Warnwert muss unter dem Grenzwert liegen');
    if (interval != null && !(Number.isInteger(interval) && interval >= 1 && interval <= 60)) throw bad('change_interval_days', 'Intervall 1–60 Tage');
    if (serial && db.prepare('SELECT 1 FROM fryers WHERE device_serial = ? AND id <> ?').get(serial, f.id)) throw new HttpError(409, 'serial_taken', 'Seriennummer ist bereits einer anderen Fritteuse zugeordnet');
    db.prepare('UPDATE fryers SET tpm_limit = ?, tpm_warn = ?, limit_source = ?, change_interval_days = ?, device_serial = ?, oil_product = COALESCE(?, oil_product) WHERE id = ?')
      .run(limit, warn, source || null, interval, serial, b.oil_product ? String(b.oil_product).slice(0, 80) : null, f.id);
    audit(db, { actor: u.id, branch: branchId, action: 'set_oil_settings', entity: 'fryer', id: f.id, payload: { limit, warn, source, interval, serial } });
    return { ok: true };
  });

  // Import von Messwerten (Berichtsexport eines Messgeräts) – Fallback ohne verifizierte Hersteller-Schnittstelle.
  // Zeilen: { device_serial, measured_at (ISO), tpm, temperature }. source 'test' = ausdrücklich Testdaten.
  route('POST', '/api/oil/import', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const source = ctx.body.source === 'test' ? 'test' : 'import';
    const rows = Array.isArray(ctx.body.rows) ? ctx.body.rows.slice(0, 2000) : [];
    if (!rows.length) throw bad('rows', 'Keine Zeilen');
    const res = { imported: 0, duplicates: 0, unknown_devices: [], invalid: 0, blocked: [] };
    tx(db, () => {
      for (const r of rows) {
        const f = db.prepare('SELECT * FROM fryers WHERE device_serial = ? AND branch_id = ?').get(String(r.device_serial || '').trim(), branchId);
        if (!f) { if (!res.unknown_devices.includes(r.device_serial)) res.unknown_devices.push(r.device_serial); continue; }
        const t = Date.parse(r.measured_at);
        const tpm = r.tpm === '' || r.tpm == null ? null : Number(r.tpm);
        const temp = r.temperature === '' || r.temperature == null ? null : Number(r.temperature);
        if (!Number.isFinite(t) || (tpm != null && !(tpm >= 0 && tpm <= 100)) || (temp != null && !(temp >= -20 && temp <= 300)) || (tpm == null && temp == null)) { res.invalid++; continue; }
        const at = new Date(t).toISOString();
        const ins = db.prepare(`INSERT OR IGNORE INTO oil_events (fryer_id, branch_id, type, tpm, temperature, source, measured_at, device_serial, created_by, note)
          VALUES (?,?,'tpm',?,?,?,?,?,?,?)`).run(f.id, branchId, tpm, temp, source, at, f.device_serial, u.id, source === 'test' ? 'TESTDATEN – kein echter Messwert' : 'Import');
        if (!ins.changes) { res.duplicates++; continue; }
        res.imported++;
        const fresh = db.prepare('SELECT * FROM fryers WHERE id = ?').get(f.id);
        // Testdaten sperren keine echte Fritteuse
        if (source === 'import' && tpm != null && fresh.tpm_limit != null && tpm >= fresh.tpm_limit && !fresh.blocked) {
          evaluateMeasurement(db, fresh, { tpm, quality_ok: null }, u.id, notify);
          res.blocked.push(fresh.name);
        }
      }
      audit(db, { actor: u.id, branch: branchId, action: 'oil_import', entity: 'oil_events', payload: { ...res, source } });
    });
    return res;
  });
}
