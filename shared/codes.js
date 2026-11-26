// Erkennung gescannter Codes. Reine Funktionen, im Browser und auf dem Server nutzbar.
// Unterstützt: GTIN/EAN (8, 12, 13, 14 Stellen mit GS1-Prüfziffer), GS1-Elementstrings mit (01)/(10)/(17),
// GS1 Digital Link URLs (…/01/<GTIN>) und sonstige URLs. Eine METRO-Artikelnummer wird NICHT geraten:
// Sie wird nur erkannt, wenn sie im Artikelstamm hinterlegt ist (Abgleich auf dem Server).

export function gs1CheckDigitValid(digits) {
  if (!/^\d+$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.at(-1));
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const n = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10 === check;
}

export function normalizeGtin(digits) {
  return digits.padStart(14, '0');
}

function parseGs1ElementString(s) {
  // Klammerform: (01)04012345123456(10)ABC(17)261231
  const out = {};
  const re = /\((\d{2,4})\)([^()]+)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  if (Object.keys(out).length) return out;
  // Rohform mit FNC1/GS-Trennzeichen (\x1d): 0104012345123456 10ABC\x1d 17261231
  if (/^01\d{14}/.test(s)) {
    out['01'] = s.slice(2, 16);
    let rest = s.slice(16);
    while (rest.length) {
      if (rest.startsWith('17') && rest.length >= 8) { out['17'] = rest.slice(2, 8); rest = rest.slice(8); continue; }
      if (rest.startsWith('15') && rest.length >= 8) { out['15'] = rest.slice(2, 8); rest = rest.slice(8); continue; }
      if (rest.startsWith('10')) {
        const end = rest.indexOf('\x1d');
        out['10'] = end === -1 ? rest.slice(2) : rest.slice(2, end);
        rest = end === -1 ? '' : rest.slice(end + 1);
        continue;
      }
      break;
    }
    return out;
  }
  return null;
}

function yymmddToIso(v) {
  if (!/^\d{6}$/.test(v)) return null;
  const yy = Number(v.slice(0, 2)), mm = Number(v.slice(2, 4));
  let dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const year = 2000 + yy;
  if (dd === 0) dd = new Date(Date.UTC(year, mm, 0)).getUTCDate(); // GS1: Tag 00 = Monatsende
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * @returns {{kind:'gtin'|'url'|'unknown', raw:string, gtin?:string, batch?:string, bestBefore?:string,
 *            url?:string, host?:string, trusted?:boolean}}
 */
export function classifyCode(input, trustedHosts = ['metro.de']) {
  const raw = String(input ?? '').trim();
  if (!raw) return { kind: 'unknown', raw };

  if (/^https?:\/\//i.test(raw)) {
    let u;
    try { u = new URL(raw); } catch { return { kind: 'unknown', raw }; }
    const host = u.hostname.toLowerCase();
    const trusted = u.protocol === 'https:' && trustedHosts.some((h) => host === h || host.endsWith('.' + h));
    const res = { kind: 'url', raw, url: u.toString(), host, trusted };
    // GS1 Digital Link: /01/<GTIN>[/10/<Charge>]
    const dl = u.pathname.match(/\/01\/(\d{8,14})(?:\/10\/([^/]+))?/);
    if (dl && gs1CheckDigitValid(dl[1])) {
      res.gtin = normalizeGtin(dl[1]);
      if (dl[2]) res.batch = decodeURIComponent(dl[2]);
      const exp = u.searchParams.get('17');
      if (exp) res.bestBefore = yymmddToIso(exp) ?? undefined;
    }
    return res;
  }

  const gs1 = parseGs1ElementString(raw);
  if (gs1 && gs1['01'] && gs1CheckDigitValid(gs1['01'])) {
    const r = { kind: 'gtin', raw, gtin: normalizeGtin(gs1['01']) };
    if (gs1['10']) r.batch = gs1['10'];
    const d = gs1['17'] || gs1['15'];
    if (d) r.bestBefore = yymmddToIso(d) ?? undefined;
    return r;
  }

  const digits = raw.replace(/[\s-]/g, '');
  if (/^\d{8}$|^\d{12,14}$/.test(digits) && gs1CheckDigitValid(digits)) {
    return { kind: 'gtin', raw, gtin: normalizeGtin(digits) };
  }
  return { kind: 'unknown', raw };
}
