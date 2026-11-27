// Marinaden-Protokoll (Handbuch Kap. 6): feste, versionierte Rezeptur; Mengen werden je kg Fleisch berechnet,
// Mitarbeiter tragen die tatsächlich abgewogenen Mengen ein, Zutaten können nicht geändert werden.
// Rezepturen liegen nur in der Datenbank (nicht im Repository). Nur der Betreiber (Admin) legt sie an oder ändert sie.
import { tx, audit } from './db.js';
import { berlinDate } from './app.js';
import { stationAccess } from './stations.js';

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// 14 Hauptallergene nach Verordnung (EU) Nr. 1169/2011, Anhang II
export const ALLERGEN_CODES = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'];
const codesOf = (v) => (v.allergen_codes ? v.allergen_codes.split(',').filter(Boolean) : []);

function recipe(db, marinadeId, version) {
  const m = db.prepare('SELECT * FROM marinades WHERE id = ?').get(marinadeId);
  if (!m) return null;
  const v = db.prepare('SELECT * FROM marinade_versions WHERE marinade_id = ? AND version = ?').get(marinadeId, version ?? m.current_version);
  return { id: m.id, name: m.name, active: !!m.active, version: v.version, ingredients: JSON.parse(v.ingredients), allergens: v.allergens, allergen_codes: codesOf(v),
    tolerance_percent: v.tolerance_percent, use_within_hours: v.use_within_hours, use_source: v.use_source };
}

function validateRecipe(b, bad) {
  const name = String(b.name || '').trim();
  if (!name) throw bad('name', 'Name der Marinade fehlt');
  const ingredients = (Array.isArray(b.ingredients) ? b.ingredients : []).filter((i) => String(i.name || '').trim());
  if (!ingredients.length) throw bad('ingredients', 'Mindestens eine Zutat');
  const clean = ingredients.map((i) => {
    const per = Number(i.per_kg);
    if (!(per > 0)) throw bad('per_kg', `Menge je kg für „${i.name}“ fehlt`);
    if (!['g', 'kg', 'ml', 'L', 'Stück'].includes(i.unit)) throw bad('unit', 'Einheit: g, kg, ml, L oder Stück');
    return { name: String(i.name).trim().slice(0, 80), per_kg: per, unit: i.unit };
  });
  const tol = b.tolerance_percent === '' || b.tolerance_percent == null ? null : Number(b.tolerance_percent);
  if (tol != null && !(tol >= 0 && tol <= 50)) throw bad('tolerance_percent', 'Toleranz 0–50 %');
  const hours = b.use_within_hours === '' || b.use_within_hours == null ? null : Number(b.use_within_hours);
  if (hours != null && !(Number.isInteger(hours) && hours >= 1 && hours <= 336)) throw bad('use_within_hours', 'Verwendbar 1–336 Stunden');
  const source = String(b.use_source || '').trim() || null;
  if (hours != null && !source) throw bad('use_source', 'Quelle für die Verwendungsfrist angeben (z. B. HACCP-Plan)');
  const codes = b.allergen_codes == null ? null : (Array.isArray(b.allergen_codes) ? b.allergen_codes : String(b.allergen_codes).split(',')).map((c) => String(c).trim()).filter(Boolean);
  if (codes && codes.some((c) => !ALLERGEN_CODES.includes(c))) throw bad('allergen_codes', 'Unbekannter Allergen-Code');
  return { name: name.slice(0, 60), ingredients: clean, allergens: String(b.allergens || '').trim().slice(0, 300) || null, tolerance: tol, hours, source,
    codes: codes ? [...new Set(codes)].sort((a, c) => ALLERGEN_CODES.indexOf(a) - ALLERGEN_CODES.indexOf(c)).join(',') : null };
}

export function registerMarinades({ route, db, needUser, needBranch, needAdmin, HttpError, bad, notFound, notify }) {
  const meatItems = () => db.prepare('SELECT id, name, unit FROM items WHERE active = 1 AND meat = 1 ORDER BY name').all();
  const batchView = (b) => ({ ...b, ingredients: JSON.parse(b.ingredients),
    marinade: db.prepare('SELECT name FROM marinades WHERE id = ?').get(b.marinade_id).name,
    meat: db.prepare('SELECT name FROM items WHERE id = ?').get(b.meat_item_id).name,
    by: db.prepare('SELECT display_name FROM users WHERE id = ?').get(b.created_by).display_name,
    expired: !!(b.use_by && b.status === 'active' && Date.parse(b.use_by) <= Date.now()),
    allergens: db.prepare('SELECT allergens FROM marinade_versions WHERE marinade_id = ? AND version = ?').get(b.marinade_id, b.recipe_version).allergens });

  route('GET', '/api/marinades', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    return {
      recipes: db.prepare('SELECT id FROM marinades WHERE active = 1 ORDER BY name').all().map((m) => recipe(db, m.id)),
      meat_items: meatItems(),
      active: db.prepare("SELECT * FROM marinade_batches WHERE branch_id = ? AND status = 'active' ORDER BY id DESC").all(branchId).map(batchView),
      recent: db.prepare("SELECT * FROM marinade_batches WHERE branch_id = ? AND status <> 'active' ORDER BY id DESC LIMIT 15").all(branchId).map(batchView),
    };
  });

  route('POST', '/api/marinades/batches', (ctx) => {
    const u = needUser(ctx);
    const b = ctx.body;
    const branchId = needBranch(ctx, b.branch);
    const station = db.prepare("SELECT id FROM stations WHERE branch_id = ? AND code = 'panieren'").get(branchId);
    if (station && !stationAccess(db, u, station.id, branchId)) throw new HttpError(403, 'not_certified', 'Marinieren nur mit Freigabe für die Panierstation');
    const r = recipe(db, Number(b.marinade_id));
    if (!r || !r.active) throw bad('marinade', 'Marinade wählen');
    const meat = meatItems().find((i) => i.id === Number(b.meat_item_id));
    if (!meat) throw bad('meat', 'Fleischart wählen');
    const kg = Number(b.meat_kg);
    if (!(kg > 0 && kg <= 500)) throw bad('meat_kg', 'Fleischmenge in kg eingeben');
    const actuals = Array.isArray(b.actuals) ? b.actuals : [];
    if (actuals.length !== r.ingredients.length) throw bad('actuals', 'Für jede Zutat die abgewogene Menge eintragen (Zutaten dürfen nicht geändert werden)');
    let deviations = 0;
    const lines = r.ingredients.map((ing, i) => {
      const target = round(ing.per_kg * kg);
      const actual = Number(actuals[i]);
      if (!(actual >= 0) || actuals[i] === '' || actuals[i] == null) throw bad('actual', `Abgewogene Menge für „${ing.name}“ fehlt`);
      const devPct = target ? Math.abs(actual - target) / target * 100 : 0;
      if (r.tolerance_percent != null && devPct > r.tolerance_percent) {
        throw new HttpError(409, 'out_of_tolerance', `„${ing.name}“: ${actual} ${ing.unit} statt ${target} ${ing.unit} – außerhalb der Toleranz (${r.tolerance_percent} %). Bitte neu abwiegen.`);
      }
      if (actual !== target) deviations++;
      return { name: ing.name, unit: ing.unit, target, actual };
    });
    const today = berlinDate().replace(/-/g, '');
    const nr = db.prepare("SELECT COUNT(*) n FROM marinade_batches WHERE branch_id = ? AND batch_code LIKE ?").get(branchId, `%-${today}-%`).n + 1;
    const branchCode = db.prepare('SELECT code FROM branches WHERE id = ?').get(branchId).code.slice(0, 3).toUpperCase();
    const code = `MAR-${branchCode}-${today}-${String(nr).padStart(2, '0')}`;
    const now = new Date();
    const useBy = r.use_within_hours ? new Date(now.getTime() + r.use_within_hours * 3600e3).toISOString() : null;
    return tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO marinade_batches (branch_id, marinade_id, recipe_version, meat_item_id, meat_kg, ingredients, deviations, batch_code, use_by, remaining_kg, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(branchId, r.id, r.version, meat.id, kg, JSON.stringify(lines), deviations, code, useBy, kg, String(b.note || '').slice(0, 300) || null, u.id).lastInsertRowid);
      // Fleischverbrauch im Bestand buchen
      db.prepare("INSERT INTO stock_movements (branch_id, item_id, qty_delta, type, note, created_by) VALUES (?,?,?,'consumption',?,?)").run(branchId, meat.id, -kg, `Mariniert: Charge ${code}`, u.id);
      if (deviations) notify(db, branchId, 'marinade', `Charge ${code}: ${deviations} Zutat(en) weichen von der Rezeptur ab`, `batch:${id}`);
      audit(db, { actor: u.id, branch: branchId, action: 'marinade_batch', entity: 'marinade_batch', id, payload: { code, marinade: r.id, version: r.version, kg, deviations } });
      return batchView(db.prepare('SELECT * FROM marinade_batches WHERE id = ?').get(id));
    });
  });

  const batchFor = (ctx) => {
    const b = db.prepare('SELECT * FROM marinade_batches WHERE id = ?').get(Number(ctx.params.id));
    if (!b) throw notFound();
    needBranch(ctx, b.branch_id);
    if (b.status !== 'active') throw new HttpError(409, 'closed', 'Charge ist bereits abgeschlossen');
    return b;
  };
  route('POST', '/api/marinades/batches/:id/rest', (ctx) => {
    const u = needUser(ctx);
    const b = batchFor(ctx);
    const rest = Number(ctx.body.remaining_kg);
    if (!(rest >= 0) || ctx.body.remaining_kg === '' || rest > b.meat_kg) throw bad('remaining_kg', `Restmenge 0–${b.meat_kg} kg`);
    if (b.use_by && Date.parse(b.use_by) <= Date.now() && rest > 0) throw new HttpError(409, 'expired', 'Verwendungsfrist abgelaufen – Rest bitte entsorgen');
    const status = rest === 0 ? 'used' : 'active';
    db.prepare('UPDATE marinade_batches SET remaining_kg = ?, status = ?, closed_by = ?, closed_at = ? WHERE id = ?')
      .run(rest, status, status === 'used' ? u.id : null, status === 'used' ? new Date().toISOString() : null, b.id);
    audit(db, { actor: u.id, branch: b.branch_id, action: 'marinade_rest', entity: 'marinade_batch', id: b.id, payload: { rest } });
    return { ok: true, status };
  });
  route('POST', '/api/marinades/batches/:id/discard', (ctx) => {
    const u = needUser(ctx);
    const b = batchFor(ctx);
    const reason = String(ctx.body.reason || '').trim();
    if (reason.length < 2) throw bad('reason', 'Grund für die Entsorgung angeben');
    db.prepare("UPDATE marinade_batches SET status = 'discarded', discard_reason = ?, closed_by = ?, closed_at = ? WHERE id = ?").run(reason.slice(0, 200), u.id, new Date().toISOString(), b.id);
    notify(db, b.branch_id, 'marinade', `Charge ${b.batch_code} entsorgt (${b.remaining_kg ?? b.meat_kg} kg): ${reason}`, `batch:${b.id}`);
    audit(db, { actor: u.id, branch: b.branch_id, action: 'marinade_discard', entity: 'marinade_batch', id: b.id, payload: { reason, kg: b.remaining_kg } });
    return { ok: true };
  });

  // Allergene aus den aktuellen, vom Betreiber gespeicherten Rezepturen – für alle Mitarbeiter lesbar (keine Mengen)
  route('GET', '/api/allergens', (ctx) => {
    needUser(ctx);
    needBranch(ctx, ctx.query.get('branch'));
    return { codes: ALLERGEN_CODES, marinades: db.prepare('SELECT id FROM marinades WHERE active = 1 ORDER BY name').all().map((m) => {
      const r = recipe(db, m.id);
      return { id: r.id, name: r.name, version: r.version, allergen_codes: r.allergen_codes, allergens: r.allergens };
    }) };
  });

  // --- Rezepturen (nur Betreiber) ---
  route('GET', '/api/admin/marinades', (ctx) => {
    needAdmin(ctx);
    return db.prepare('SELECT id FROM marinades ORDER BY name').all().map((m) => ({ ...recipe(db, m.id),
      versions: db.prepare('SELECT version, created_at FROM marinade_versions WHERE marinade_id = ? ORDER BY version DESC').all(m.id) }));
  });
  route('POST', '/api/admin/marinades', (ctx) => {
    const a = needAdmin(ctx);
    const v = validateRecipe(ctx.body, bad);
    if (db.prepare('SELECT 1 FROM marinades WHERE name = ?').get(v.name)) throw new HttpError(409, 'duplicate', 'Marinade mit diesem Namen existiert');
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO marinades (name) VALUES (?)').run(v.name).lastInsertRowid);
      db.prepare('INSERT INTO marinade_versions (marinade_id, version, ingredients, allergens, tolerance_percent, use_within_hours, use_source, created_by, allergen_codes) VALUES (?,1,?,?,?,?,?,?,?)')
        .run(id, JSON.stringify(v.ingredients), v.allergens, v.tolerance, v.hours, v.source, a.id, v.codes);
      audit(db, { actor: a.id, action: 'create', entity: 'marinade', id, payload: { name: v.name } });
      return { id };
    });
  });
  // Änderung = neue Version; alte Chargen behalten ihre Version
  route('PUT', '/api/admin/marinades/:id', (ctx) => {
    const a = needAdmin(ctx);
    const m = db.prepare('SELECT * FROM marinades WHERE id = ?').get(Number(ctx.params.id));
    if (!m) throw notFound();
    const v = validateRecipe({ ...ctx.body, name: m.name }, bad);
    const next = m.current_version + 1;
    tx(db, () => {
      db.prepare('INSERT INTO marinade_versions (marinade_id, version, ingredients, allergens, tolerance_percent, use_within_hours, use_source, created_by, allergen_codes) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(m.id, next, JSON.stringify(v.ingredients), v.allergens, v.tolerance, v.hours, v.source, a.id,
          v.codes ?? db.prepare('SELECT allergen_codes FROM marinade_versions WHERE marinade_id = ? AND version = ?').get(m.id, m.current_version)?.allergen_codes ?? null);
      db.prepare('UPDATE marinades SET current_version = ?, active = ? WHERE id = ?').run(next, ctx.body.active === false ? 0 : 1, m.id);
      audit(db, { actor: a.id, action: 'new_version', entity: 'marinade', id: m.id, payload: { version: next } });
    });
    return { ok: true, version: next };
  });
}
