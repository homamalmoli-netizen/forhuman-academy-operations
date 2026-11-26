// Bestandsalarme und einfache Nachbestellliste (Issue #20) – ohne Preise, ohne automatische Bestellung, keine Warenwirtschaft.
// Alarmstufen je Kontrolle: zero (Ist = 0, immer kritisch), urgent (unter zusätzlicher dringender Schwelle), below (unter Mindestwert).
// Leeres Feld = unbekannt (wird nie als 0 gewertet – leere Felder werden schon bei der Abgabe abgelehnt).
import { tx, audit } from './db.js';
import { berlinDate } from './app.js';

export const ZERO_ESCALATE_MIN = 30; // kritische Nullmeldung ohne Bestätigung → erneut an Betreiber und Leitung

const admins = (db) => db.prepare('SELECT id FROM users WHERE is_admin = 1 AND active = 1').all().map((r) => r.id);
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ','));

export function levelFor(item, qty) {
  if (qty === 0) return 'zero';
  if (item.urgent_below != null && qty < item.urgent_below) return 'urgent';
  if (item.min_qty != null && qty < item.min_qty) return 'below';
  return null;
}

/** Nach jeder Kontrolle oder Bestandsbestätigung: Alarme anlegen, deduplizieren, auflösen und benachrichtigen. */
export function evaluateStock(db, { branchId, runId = null, userId, entries, notify, source = 'Kontrolle' }) {
  const branch = db.prepare('SELECT name FROM branches WHERE id = ?').get(branchId)?.name || '';
  const who = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)?.display_name || '';
  const time = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  const created = [];
  tx(db, () => {
    for (const { item, qty } of entries) {
      const level = levelFor(item, qty);
      const open = db.prepare("SELECT * FROM stock_alerts WHERE branch_id = ? AND item_id = ? AND status <> 'resolved' ORDER BY id DESC").all(branchId, item.id);
      if (!level) {
        if (open.length) db.prepare("UPDATE stock_alerts SET status = 'resolved', resolved_at = ? WHERE branch_id = ? AND item_id = ? AND status <> 'resolved'").run(new Date().toISOString(), branchId, item.id);
        continue;
      }
      const last = open[0];
      // dieselbe Kontrollperiode erneut gespeichert und nicht schlechter → keine neue Meldung
      if (last && runId != null && last.run_id === runId && qty >= last.qty) continue;
      if (last && runId == null && qty >= last.qty) continue;
      if (open.length) db.prepare("UPDATE stock_alerts SET status = 'resolved', resolved_at = ? WHERE branch_id = ? AND item_id = ? AND status <> 'resolved'").run(new Date().toISOString(), branchId, item.id);
      const shortfall = item.min_qty != null ? Math.max(0, item.min_qty - qty) : null;
      const id = Number(db.prepare('INSERT INTO stock_alerts (branch_id, item_id, run_id, level, qty, min_qty, shortfall, reported_by) VALUES (?,?,?,?,?,?,?,?)')
        .run(branchId, item.id, runId, level, qty, item.min_qty, shortfall, userId).lastInsertRowid);
      created.push({ id, item, qty, level, shortfall });
    }
  });
  if (!created.length) return created;
  const line = (c) => `${c.item.name}: Ist ${fmt(c.qty)} ${c.item.unit}${c.item.min_qty != null ? `, Minimum ${fmt(c.item.min_qty)}, Fehlmenge ${fmt(c.shortfall)}` : ', Minimum offen'}${c.level === 'urgent' ? ` (unter ${fmt(c.item.urgent_below)} – dringend)` : ''}`;
  const zero = created.filter((c) => c.level === 'zero'), rest = created.filter((c) => c.level !== 'zero');
  const send = (kind, text, key) => {
    notify(db, branchId, kind, text, key, null, 'manager');
    for (const a of admins(db)) notify(db, branchId, kind, text, `${key}:admin:${a}`, a, 'admin');
  };
  if (zero.length) send('critical', `KRITISCH – Bestand 0 (${branch}): ${zero.map(line).join('; ')}. Gemeldet von ${who}, ${time} (${source}). Bitte bestätigen und nachbestellen.`, `remind:alert:${zero.map((z) => z.id).join('-')}:zero`);
  if (rest.length) send('stock', `Unter Mindestbestand (${branch}): ${rest.map(line).join('; ')}. Gemeldet von ${who}, ${time} (${source}).`, `remind:alert:${rest.map((z) => z.id).join('-')}:below`);
  return created;
}

/** Kritische Nullmeldungen ohne Bestätigung nach 30 Minuten erneut melden (einmal). */
export function escalateZeroAlerts(db, branchId, now = new Date(), notify) {
  const old = db.prepare(`SELECT a.*, i.name, i.unit FROM stock_alerts a JOIN control_items i ON i.id = a.item_id
    WHERE a.branch_id = ? AND a.level = 'zero' AND a.status = 'open' AND a.created_at <= ?`).all(branchId, new Date(now.getTime() - ZERO_ESCALATE_MIN * 60000).toISOString());
  let n = 0;
  for (const a of old) {
    const text = `Noch NICHT bestätigt: Bestand 0 bei ${a.name} seit ${ZERO_ESCALATE_MIN} Minuten. Bitte sofort bestätigen und nachbestellen.`;
    n += notify(db, branchId, 'critical', text, `remind:alert:${a.id}:esc`, null, 'manager');
    for (const ad of admins(db)) notify(db, branchId, 'critical', text, `remind:alert:${a.id}:esc:admin:${ad}`, ad, 'admin');
  }
  return n;
}

/** Letzter bekannter Bestand je Artikel: neueste Kontrolle oder Bestandsbestätigung bei Lieferung. */
function latestStock(db, itemId) {
  const c = db.prepare(`SELECT x.qty, r.completed_at at FROM control_run_lines x JOIN control_runs r ON r.id = x.run_id
    WHERE x.item_id = ? AND r.status = 'done' ORDER BY r.completed_at DESC LIMIT 1`).get(itemId);
  const d = db.prepare(`SELECT rc.stock_after qty, rc.received_at at FROM stock_order_receipts rc JOIN stock_orders o ON o.id = rc.order_id
    WHERE o.item_id = ? ORDER BY rc.received_at DESC LIMIT 1`).get(itemId);
  if (!c && !d) return null;
  return !d || (c && c.at >= d.at) ? c : d;
}

export function reorderList(db, branchId) {
  const items = db.prepare(`SELECT i.*, l.name list FROM control_items i JOIN control_lists l ON l.id = i.list_id
    WHERE l.branch_id = ? AND i.active = 1 AND l.active = 1 ORDER BY l.position, i.position`).all(branchId);
  const out = [];
  for (const i of items) {
    const s = latestStock(db, i.id);
    if (!s) continue;
    const level = levelFor(i, s.qty);
    if (!level) continue;
    const outstanding = db.prepare("SELECT COALESCE(SUM(qty_ordered - qty_received), 0) q FROM stock_orders WHERE item_id = ? AND status IN ('ordered','partial')").get(i.id).q;
    const base = i.target_qty ?? i.min_qty;
    const suggest = base != null ? Math.max(0, Math.round((base - s.qty - outstanding) * 100) / 100) : null;
    out.push({ item_id: i.id, name: i.name, unit: i.unit, list: i.list, supplier: i.supplier || null, article_no: i.article_no, pack_info: i.pack_info,
      critical: !!i.critical, image_media_id: i.image_media_id, qty: s.qty, counted_at: s.at, min_qty: i.min_qty, target_qty: i.target_qty,
      level, outstanding, suggest });
  }
  return out;
}

export function registerStock({ route, db, needUser, needBranch, HttpError, bad, notFound, notify, SEC_HEADERS = {} }) {
  route('GET', '/api/stock/alerts', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'shift_lead', 'manager', 'admin');
    return db.prepare(`SELECT a.*, i.name, i.unit, i.image_media_id, u.display_name reported_name, k.display_name ack_name FROM stock_alerts a
      JOIN control_items i ON i.id = a.item_id LEFT JOIN users u ON u.id = a.reported_by LEFT JOIN users k ON k.id = a.ack_by
      WHERE a.branch_id = ? AND a.status <> 'resolved' ORDER BY CASE a.level WHEN 'zero' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, a.created_at DESC`).all(branchId);
  });

  route('POST', '/api/stock/alerts/:id/ack', (ctx) => {
    const u = needUser(ctx);
    const a = db.prepare('SELECT * FROM stock_alerts WHERE id = ?').get(Number(ctx.params.id)); if (!a) throw notFound();
    const branchId = needBranch(ctx, a.branch_id, 'shift_lead', 'manager', 'admin');
    if (a.status !== 'open') throw new HttpError(409, 'not_open', 'Schon bestätigt oder erledigt');
    db.prepare("UPDATE stock_alerts SET status = 'acknowledged', ack_by = ?, ack_at = ? WHERE id = ?").run(u.id, new Date().toISOString(), a.id);
    audit(db, { actor: u.id, branch: branchId, action: 'stock_alert_ack', entity: 'stock_alert', id: a.id });
    return { ok: true };
  });

  route('GET', '/api/stock/reorder', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'), 'shift_lead', 'manager', 'admin');
    const list = reorderList(db, branchId);
    if (ctx.query.get('format') === 'csv') {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Lieferant', 'Artikel', 'Artikelnummer', 'Gebinde', 'Einheit', 'Ist', 'Minimum', 'Zielbestand', 'Bereits bestellt', 'Vorschlag Menge', 'Stufe']]
        .concat(list.map((r) => [r.supplier || 'unbekannt', r.name, r.article_no, r.pack_info, r.unit, r.qty, r.min_qty ?? 'offen', r.target_qty ?? '', r.outstanding, r.suggest ?? 'offen', r.level]));
      ctx.res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="nachbestellliste-${berlinDate()}.csv"` });
      ctx.res.end('\ufeff' + rows.map((r) => r.map(esc).join(';')).join('\r\n'));
      return undefined;
    }
    const groups = {};
    for (const r of list) (groups[r.supplier || 'Lieferant offen'] ||= []).push(r);
    const orders = db.prepare(`SELECT o.*, i.name, u.display_name ordered_name FROM stock_orders o JOIN control_items i ON i.id = o.item_id
      JOIN users u ON u.id = o.ordered_by WHERE o.branch_id = ? AND o.status IN ('ordered','partial') ORDER BY o.ordered_on DESC, o.id DESC`).all(branchId);
    return { groups, orders };
  });

  // Offene Bestellungen für den Wareneingang (alle Mitarbeiter der Filiale)
  route('GET', '/api/stock/orders/open', (ctx) => {
    needUser(ctx);
    const branchId = needBranch(ctx, ctx.query.get('branch'));
    return db.prepare(`SELECT o.id, o.supplier, o.qty_ordered, o.qty_received, o.unit, o.ordered_on, o.expected_on, o.status, i.name, i.pack_info, i.image_media_id
      FROM stock_orders o JOIN control_items i ON i.id = o.item_id WHERE o.branch_id = ? AND o.status IN ('ordered','partial') ORDER BY o.expected_on IS NULL, o.expected_on, o.id`).all(branchId);
  });

  route('POST', '/api/stock/orders', (ctx) => {
    const u = needUser(ctx);
    const branchId = needBranch(ctx, ctx.body.branch, 'manager', 'admin');
    const item = db.prepare('SELECT i.*, l.branch_id FROM control_items i JOIN control_lists l ON l.id = i.list_id WHERE i.id = ?').get(Number(ctx.body.item_id));
    if (!item || item.branch_id !== branchId) throw bad('item_id');
    const qty = Number(ctx.body.qty);
    if (!(qty > 0)) throw bad('qty', 'Bestellmenge größer 0');
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const orderedOn = day.test(ctx.body.ordered_on || '') ? ctx.body.ordered_on : berlinDate();
    const expected = day.test(ctx.body.expected_on || '') ? ctx.body.expected_on : null;
    const id = Number(db.prepare('INSERT INTO stock_orders (branch_id, item_id, supplier, qty_ordered, unit, ordered_on, expected_on, ordered_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(branchId, item.id, String(ctx.body.supplier || item.supplier || '').trim().slice(0, 80) || null, qty, item.unit, orderedOn, expected, u.id, String(ctx.body.note || '').slice(0, 200) || null).lastInsertRowid);
    audit(db, { actor: u.id, branch: branchId, action: 'stock_order', entity: 'stock_order', id, payload: { item: item.id, qty } });
    return { id };
  });

  // Lieferung: tatsächlich erhaltene Menge + aktueller Bestand (Pflicht). Teillieferungen bleiben offen.
  route('POST', '/api/stock/orders/:id/receive', (ctx) => {
    const u = needUser(ctx);
    const o = db.prepare('SELECT * FROM stock_orders WHERE id = ?').get(Number(ctx.params.id)); if (!o) throw notFound();
    const branchId = needBranch(ctx, o.branch_id);
    if (!['ordered', 'partial'].includes(o.status)) throw new HttpError(409, 'not_open', 'Bestellung ist nicht offen');
    const qty = Number(ctx.body.qty);
    if (!(qty > 0)) throw bad('qty', 'Erhaltene Menge größer 0');
    const after = ctx.body.stock_after === '' || ctx.body.stock_after == null ? NaN : Number(ctx.body.stock_after);
    if (!Number.isFinite(after) || after < 0) throw bad('stock_after', 'Aktuellen Bestand nach dem Einräumen eintragen (0 ist gültig)');
    const total = Math.round((o.qty_received + qty) * 1000) / 1000;
    const status = total >= o.qty_ordered ? 'received' : 'partial';
    tx(db, () => {
      db.prepare('INSERT INTO stock_order_receipts (order_id, qty, stock_after, received_by, note) VALUES (?,?,?,?,?)').run(o.id, qty, after, u.id, String(ctx.body.note || '').slice(0, 200) || null);
      db.prepare('UPDATE stock_orders SET qty_received = ?, status = ? WHERE id = ?').run(total, status, o.id);
    });
    const item = db.prepare('SELECT * FROM control_items WHERE id = ?').get(o.item_id);
    evaluateStock(db, { branchId, userId: u.id, entries: [{ item, qty: after }], notify, source: 'Wareneingang' });
    audit(db, { actor: u.id, branch: branchId, action: 'stock_receive', entity: 'stock_order', id: o.id, payload: { qty, after, status } });
    return { ok: true, status, open_qty: Math.max(0, Math.round((o.qty_ordered - total) * 1000) / 1000) };
  });

  route('POST', '/api/stock/orders/:id/cancel', (ctx) => {
    const u = needUser(ctx);
    const o = db.prepare('SELECT * FROM stock_orders WHERE id = ?').get(Number(ctx.params.id)); if (!o) throw notFound();
    const branchId = needBranch(ctx, o.branch_id, 'manager', 'admin');
    if (!['ordered', 'partial'].includes(o.status)) throw new HttpError(409, 'not_open');
    db.prepare("UPDATE stock_orders SET status = 'cancelled' WHERE id = ?").run(o.id);
    audit(db, { actor: u.id, branch: branchId, action: 'stock_order_cancel', entity: 'stock_order', id: o.id });
    return { ok: true };
  });
}
