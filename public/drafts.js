// Offline-Entwürfe (Issue #20): Eingaben ohne Netz werden auf dem Gerät gespeichert – sie gelten NICHT als erledigt.
// Erst wenn der Server die Abgabe angenommen hat, wird der Entwurf gelöscht. Lehnt der Server ab (z. B. Foto fehlt,
// Frist vorbei), bleibt der Entwurf mit der Meldung sichtbar und muss in der App neu erfasst oder verworfen werden.
const DB = 'fh-offline', STORE = 'drafts';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result ?? out); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export const available = () => typeof indexedDB !== 'undefined';

/** Entwurf speichern. photos: { feldname: { blob, purpose } } – Fotos werden erst beim Senden hochgeladen. */
export async function saveDraft(d) {
  const draft = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'pending', error: null, saved_at: new Date().toISOString(), ...d };
  await run('readwrite', (s) => s.put(draft));
  return draft;
}

export async function listDrafts(userId) {
  const all = await run('readonly', (s) => s.getAll());
  return (all || []).filter((d) => d.user_id === userId).sort((a, b) => a.saved_at.localeCompare(b.saved_at));
}

export const deleteDraft = (id) => run('readwrite', (s) => s.delete(id));
const update = (d) => run('readwrite', (s) => s.put(d));

/**
 * Sendet alle offenen Entwürfe der Person. upload(blob, purpose) → {id}; post(url, body) → Antwort.
 * Netzfehler (status 0): Entwurf bleibt „pending“. Ablehnung durch den Server: „rejected“ mit Meldung.
 */
export async function syncDrafts(userId, { upload, post }) {
  const res = { sent: 0, rejected: 0, pending: 0 };
  for (const d of await listDrafts(userId)) {
    if (d.status !== 'pending') { res.rejected++; continue; }
    try {
      const body = { ...d.body };
      for (const [field, p] of Object.entries(d.photos || {})) {
        if (!body[field]) body[field] = (await upload(p.blob, p.purpose, d.branch)).id;
      }
      await post(d.url, body);
      await deleteDraft(d.id);
      res.sent++;
    } catch (e) {
      if (e?.status === 0) { res.pending++; break; } // weiterhin offline – später erneut
      await update({ ...d, status: 'rejected', error: e?.body?.message || e?.message || 'Abgelehnt' });
      res.rejected++;
    }
  }
  return res;
}
