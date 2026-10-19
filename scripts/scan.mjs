/* Monitor legal Aferium — varredura das fontes oficiais.
   Lê public/legal/sources.json, confere cada fonte, compara com a varredura anterior e grava
   public/legal/status.json, public/legal/history.json e public/legal/text/<fonte>.txt.
   Não usa nenhuma biblioteca externa (Node 20+). Mudanças exigem revisão humana: o monitor só avisa. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCAN_TIMES_UTC = ['09:17', '21:17']; // 06:17 e 18:17 em Maceió (UTC-3); precisa bater com o cron do workflow
const FAIL_THRESHOLD = 4;                  // execuções seguidas com falha antes de contar como indisponível
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_TEXT = 400 * 1024;
const HISTORY_CAP = 500;
const UA = 'Mozilla/5.0 (compatible; AferiumLegalMonitor/1.0; +https://aferiumquality.com.br)';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return fb; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ordm: 'º', ordf: 'ª', sect: '§', ccedil: 'ç', Ccedil: 'Ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ', ndash: '–', mdash: '—' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') { const n = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
    return Object.prototype.hasOwnProperty.call(ENT, g) ? ENT[g] : m;
  });
}
function decodeBody(buf, contentType) {
  const head = buf.subarray(0, 4096).toString('latin1');
  const label = (/charset=["']?([\w-]+)/i.exec(contentType || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1];
  try { const t = new TextDecoder(label || 'utf-8').decode(buf); if (!label && t.includes('�')) return new TextDecoder('windows-1252').decode(buf); return t; }
  catch (_) { return new TextDecoder('utf-8').decode(buf); }
}
export function htmlToLines(html) {
  let h = String(html);
  h = h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const main = /<main[\s>][\s\S]*?<\/main>/i.exec(h) || /<(div|section|article)[^>]+id=["'](?:content-core|parent-fieldname-text|conteudo|content)["'][\s\S]*/i.exec(h);
  if (main) h = main[0];
  h = h.replace(/<\/(p|div|li|ul|ol|tr|h[1-6]|section|article|table|blockquote|dd|dt)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const lines = decodeEntities(h).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  for (const l of lines) if (l !== out[out.length - 1] && !/^\d{1,2}\/\d{1,2}\/\d{4}( [\d:h]+)?$/.test(l)) out.push(l);
  return out;
}
export function extractLinks(html, baseUrl) {
  const out = new Map(), re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    let url; try { url = new URL(decodeEntities(m[1]), baseUrl); } catch (_) { continue; }
    if (url.protocol !== new URL(baseUrl).protocol) continue;
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!title || title.length < 6) continue;
    if (/(portaria|instru[cç][aã]o|decreto|lei\b|resolu[cç][aã]o|rdc|\bin\b|norma|manual|circular|nota t[eé]cnica)/i.test(title + ' ' + url.pathname) || /\.pdf($|\?)/i.test(url.pathname)) out.set(url.href, title.slice(0, 160));
  }
  return out;
}

async function fetchOnce(url, timeoutMs) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, 'Accept': 'text/html,application/pdf,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('arquivo grande demais');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('arquivo grande demais');
  if (!buf.length) throw new Error('resposta vazia');
  return { buf, type: res.headers.get('content-type') || '' };
}
async function fetchRetry(url, o) {
  let err;
  for (let i = 0; i < o.attempts; i++) {
    try { return await fetchOnce(url, o.timeoutMs); } catch (e) { err = e; if (i < o.attempts - 1) await sleep(o.retryDelayMs * (i + 1)); }
  }
  throw err;
}
function digest(src, got) {
  const isPdf = src.kind === 'pdf' || /pdf/i.test(got.type) || got.buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf) return { hash: sha(got.buf), bytes: got.buf.length, lines: null, links: null };
  const html = decodeBody(got.buf, got.type);
  const lines = htmlToLines(html);
  if (lines.length < 3) throw new Error('página sem conteúdo legível');
  const text = lines.join('\n');
  return { hash: sha(text), bytes: got.buf.length, lines, links: /index/.test(src.monitorMode || '') ? extractLinks(html, src.url) : null };
}
async function checkSource(src, o) {
  const a = digest(src, await fetchRetry(src.url, o));
  await sleep(o.confirmDelayMs);
  const b = digest(src, await fetchRetry(src.url, o));
  return a.hash === b.hash ? b : Object.assign(b, { unstable: true });
}
const textFile = (dir, id) => path.join(dir, 'text', String(id).replace(/[^a-z0-9_-]/gi, '_') + '.txt');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function nextScanAt(now) {
  const slots = [];
  for (let d = 0; d < 3; d++) for (const t of SCAN_TIMES_UTC) { const [h, m] = t.split(':').map(Number); const x = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, h, m)); if (x > now) slots.push(x); }
  return slots.sort((a, b) => a - b)[0].toISOString();
}

export async function runScan(opts = {}) {
  const root = opts.root || process.cwd(), dir = path.join(root, 'public', 'legal');
  const o = { attempts: 3, timeoutMs: 45000, retryDelayMs: 4000, confirmDelayMs: 3000, concurrency: 4, now: () => new Date(), ...opts };
  const sourcesDoc = readJson(path.join(dir, 'sources.json'), null);
  if (!sourcesDoc || !Array.isArray(sourcesDoc.sources)) throw new Error('sources.json ausente ou inválido');
  const prev = readJson(path.join(dir, 'status.json'), {});
  const hist = readJson(path.join(dir, 'history.json'), { schemaVersion: 2, items: [], reviews: [] });
  const prevSnap = prev.sourceSnapshots || {};
  const first = !Object.keys(prevSnap).length;
  const at = o.now(), nowIso = at.toISOString();
  const seen = new Set(), uniq = [];
  for (const s of sourcesDoc.sources) { const key = s.id; if (!s.url || seen.has(key)) continue; seen.add(key); uniq.push(s); }

  const snaps = {}, changes = [];
  const run = async src => {
    const old = prevSnap[src.id] || null;
    const base = { id: src.id, title: src.title, authority: src.authority, healthGroup: src.healthGroup || src.authority, url: src.url, kind: src.kind };
    try {
      const d = await checkSource(src, o);
      const snap = { ...base, hash: d.hash, bytes: d.bytes, fetchedAt: nowIso, lastSuccessfulAt: nowIso, consecutiveFailures: 0, lastError: '', lastChangedAt: old && old.lastChangedAt || null, recentChanges: (old && old.recentChanges) || [] };
      if (d.links) snap.links = Array.from(d.links.keys()).slice(0, 400);
      const tf = textFile(dir, src.id);
      let oldLines = null;
      if (d.lines) { try { oldLines = fs.readFileSync(tf, 'utf8').split('\n'); } catch (_) {} }
      if (old && old.hash && old.hash !== d.hash) {
        const recent = (old.recentChanges || []).filter(t => at - new Date(t) < 7 * 864e5);
        let added = [], removed = [];
        if (d.lines && oldLines) { const A = new Set(oldLines), B = new Set(d.lines); added = d.lines.filter(l => !A.has(l)); removed = oldLines.filter(l => !B.has(l)); }
        const volatile = recent.length >= 3;
        const minor = d.lines && oldLines && (added.length + removed.length) < 5;
        snap.recentChanges = recent.concat(nowIso).slice(-6);
        if (volatile) snap.volatile = true;
        if (!(volatile && minor)) {
          const addedLinks = d.links && old.links ? Array.from(d.links.entries()).filter(([u]) => !old.links.includes(u)).slice(0, 10).map(([u, t]) => ({ title: t, url: u })) : [];
          let summary;
          if (!d.lines) summary = 'O arquivo PDF desta fonte oficial foi alterado ou substituído desde a última varredura. Abra a fonte e compare com a versão anterior.';
          else summary = 'O texto desta fonte oficial mudou desde a última varredura.' + (added.length ? ' Trechos novos: ' + added.slice(0, 3).map(l => '«' + clip(l, 160) + '»').join(' ') : '') + (removed.length ? ' Trechos removidos: ' + removed.slice(0, 2).map(l => '«' + clip(l, 120) + '»').join(' ') : '');
          if (addedLinks.length) summary = 'Há novas referências nesta página oficial. ' + summary;
          changes.push({ id: src.id + '-' + d.hash.slice(0, 10), sourceId: src.id, title: 'Alteração em ' + src.title, summary, authority: src.authority, sourceTitle: src.title, sourceUrl: src.url, detectedAt: nowIso, previousHash: old.hash, newHash: d.hash, addedLinks, unstable: !!d.unstable });
          snap.lastChangedAt = nowIso;
        }
      }
      if (d.lines) { fs.mkdirSync(path.dirname(tf), { recursive: true }); fs.writeFileSync(tf, clip(d.lines.join('\n'), MAX_TEXT)); }
      snaps[src.id] = snap;
    } catch (e) {
      snaps[src.id] = { ...(old || base), ...base, fetchedAt: nowIso, consecutiveFailures: ((old && old.consecutiveFailures) || 0) + 1, lastError: clip(String(e && e.message || e), 160), lastSuccessfulAt: old && old.lastSuccessfulAt || null };
    }
  };
  const queue = uniq.slice();
  await Promise.all(Array.from({ length: Math.min(o.concurrency, queue.length) }, async () => { while (queue.length) { const s = queue.shift(); await run(s); await sleep(o.staggerMs ?? 300); } }));

  const rows = Object.values(snaps);
  const failedNow = rows.filter(r => r.consecutiveFailures > 0).length;
  const failedHard = rows.filter(r => r.consecutiveFailures >= FAIL_THRESHOLD).length;
  const okCount = rows.length - failedNow;
  let result;
  if (first) result = 'baseline_established';
  else if (okCount === 0) result = 'unavailable';
  else if (changes.length && failedHard) result = 'changes_with_partial_failure';
  else if (changes.length) result = 'changes';
  else if (failedHard) result = 'partial_failure';
  else result = 'no_changes';
  const messages = {
    baseline_established: 'Linha de base criada: as fontes oficiais foram lidas e guardadas para comparação nas próximas varreduras.',
    unavailable: 'Nenhuma fonte respondeu nesta varredura. A situação legal não pôde ser verificada.',
    changes_with_partial_failure: changes.length + ' alteração(ões) encontrada(s); ' + failedHard + ' fonte(s) sem resposta há várias varreduras.',
    changes: changes.length + ' alteração(ões) encontrada(s) nas fontes oficiais. Revise antes de qualquer mudança interna.',
    partial_failure: failedHard + ' fonte(s) sem resposta há várias varreduras. As demais foram conferidas.',
    no_changes: 'Nenhuma alteração encontrada nas ' + okCount + ' fontes conferidas.'
  };
  const status = {
    schemaVersion: 4, runId: 'scan-' + nowIso.replace(/[-:.TZ]/g, '').slice(0, 14), result, message: messages[result] + (failedNow && !failedHard ? ' ' + failedNow + ' fonte(s) aguardam nova tentativa.' : ''),
    lastScanAt: nowIso, lastSuccessfulScanAt: okCount ? nowIso : (prev.lastSuccessfulScanAt || null), nextScanAt: nextScanAt(at), timezone: 'America/Maceio', scanTime: '06:17 e 18:17',
    sourcesTotal: rows.length, sourcesChecked: rows.length, sourcesSucceeded: okCount, sourcesFailed: failedHard,
    changesCount: changes.length, changes, sourceSnapshots: snaps, baselineEstablished: true, historyVersion: 2,
    automationActive: true, reviewMode: 'automatic-scan-with-human-review', contextualReferencesHiddenByDefault: true, monitoringMode: 'github-actions-public-repository'
  };
  const ids = new Set((hist.items || []).map(i => i.id));
  hist.items = (changes.filter(c => !ids.has(c.id)).concat(hist.items || [])).slice(0, HISTORY_CAP);
  hist.schemaVersion = 2;
  writeJson(path.join(dir, 'status.json'), status);
  writeJson(path.join(dir, 'history.json'), hist);
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.MONITOR_ROOT || process.cwd();
  let s = await runScan({ root });
  if (s.result === 'baseline_established' && process.env.SCAN_NO_CONFIRM !== '1') {
    console.log('Linha de base criada; confirmando com uma segunda leitura em 60 s…');
    await sleep(60000);
    s = await runScan({ root });
  }
  console.log(`MONITOR_LEGAL ${s.result} fontes=${s.sourcesTotal} ok=${s.sourcesSucceeded} falhas=${s.sourcesFailed} alteracoes=${s.changesCount}`);
  if (s.result === 'unavailable') process.exitCode = 1;
}
