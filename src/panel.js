import { analyze, VERDICT_TEXT, spokenSummary } from './pipeline.js';
import { extractPageText } from './extract.js';
import { directTransport } from './llm.js';
import { playEarcon, speak, stopSpeaking } from './audio.js';

const IN_EXT = !!globalThis.chrome?.runtime?.id;
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const EARCON_CAPTION = {
  safe: 'Ses: yükselen iki yumuşak nota (onay)',
  caution: 'Ses: iki kısa orta perdeden uyarı',
  high: 'Ses: alçalan üç nota (durun)',
  uncertain: 'Ses: yarım kalan, soru gibi yükselen ton (emin değilim)',
};

const HARNESS_LLM = { baseURL: 'http://localhost:4173/v1', model: 'test-model', apiKey: 'test' };
let prefs = { sound: true, volume: 0.8 };
let lastReport = null;
let tabId = null, tabUrl = '';

/* ---------- küçük DOM yardımcısı: sayfadan gelen hiçbir metin innerHTML'e girmez ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; k === 'class' ? (el.className = v) : el.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}

/* ---------- ses anahtarı (tek düğme: ses imzası + sesli okuma) ---------- */
function paintSound() { const b = $('btn-sound'); b.setAttribute('aria-pressed', String(prefs.sound)); b.textContent = prefs.sound ? 'Ses: açık' : 'Ses: kapalı'; }
async function toggleSound() {
  prefs.sound = !prefs.sound; paintSound();
  if (IN_EXT) { await chrome.storage.local.set({ prefs }); if (!prefs.sound) chrome.runtime.sendMessage({ type: 'stop' }); }
  else if (!prefs.sound) stopSpeaking();
  $('live').textContent = prefs.sound ? 'Ses açıldı' : 'Ses kapatıldı';
}

/* ---------- harness (Cypress / önizleme): panel kendi başına tarar ---------- */
async function harnessExtract() {
  const name = (params.get('fixture') || 'happy').replace(/[^\w-]/g, '');
  const frame = h('iframe', { src: `fixtures/${name}.html`, 'aria-hidden': 'true', style: 'position:absolute;width:900px;height:700px;left:-9999px' });
  document.body.append(frame);
  await new Promise((ok, no) => { frame.onload = ok; frame.onerror = no; });
  const out = extractPageText(frame.contentDocument); frame.remove(); return out;
}
async function harnessScan() {
  busy(true); progress('Şartlar okunuyor…');
  try {
    const ex = await harnessExtract(); showPage(ex);
    const report = await analyze(ex, { settings: HARNESS_LLM, transport: directTransport(HARNESS_LLM),
      onProgress: p => progress(p.stage === 'llm' ? `Analiz ediliyor… (${p.done + 1}/${p.total})` : 'Alıntılar doğrulanıyor…') });
    lastReport = report; progress(''); render(report); announce(report);
  } catch (e) { progress(String(e.message || e)); } finally { busy(false); }
}

/* ---------- uzantı: sonuç arka plandan gelir, panel yalnızca gösterir ---------- */
function showPage(ex) {
  let hostName = ex.url; try { hostName = new URL(ex.url).hostname; } catch {}
  $('page-host').textContent = hostName; $('page-title').textContent = ex.title || 'Başlıksız sayfa';
}
function busy(b) { $('btn-read').disabled = b; $('btn-read').textContent = b ? 'Okunuyor…' : 'Yeniden tara'; }
function progress(t) { $('progress').textContent = t || ''; }

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return t; }

async function paintFromStore() {
  if (!tabId) return;
  const st = await chrome.storage.session.get(['r:' + tabId, 's:' + tabId]);
  const r = st['r:' + tabId], state = st['s:' + tabId];
  $('btn-agent').hidden = true;
  const tr = r?.trace || []; $('trace-wrap').hidden = !tr.length; $('trace').replaceChildren(...tr.map(t => h('li', {}, t)));
  if (state === 'scanning') { busy(true); progress('Bu sitenin şartları okunuyor. Sonucu sesli söyleyeceğim.'); return; }
  busy(false);
  if (r?.verdict) { progress(''); lastReport = r; render(r, { quiet: true }); return; }
  $('sonuc').hidden = true;
  if (r?.state === 'none') { progress('Bu sitede okunabilir bir sözleşme veya gizlilik metni bulunamadı. Denenen yollar aşağıda.'); $('btn-agent').hidden = false; }
  else if (r?.state === 'error') progress('Tarama başarısız oldu: ' + r.error);
  else progress('Bu sayfa henüz taranmadı.');
}

async function rescan() {
  if (!IN_EXT) return harnessScan();
  const t = await activeTab(); if (!t?.id) return;
  tabId = t.id; tabUrl = t.url; busy(true); progress('Şartlar okunuyor…');
  chrome.runtime.sendMessage({ type: 'scan', tabId, url: tabUrl });
}

/* ---------- render ---------- */
function findingItem(f, { showJump }) {
  const li = h('li', { class: 'finding' },
    h('h4', {}, f.categoryLabel,
      f.severityLabel && h('span', { class: 'sev', 'data-s': f.severity }, `${f.severityLabel} önem`),
      f.source === 'rule' && h('span', { class: 'src-tag' }, 'kural taramasıyla bulundu')),
    h('blockquote', { class: 'quote' }, f.quote, h('span', { class: 'quote-src' }, `Metinden birebir alıntı, bölüm ${f.segment_id + 1}`)),
    h('p', { class: 'explain' }, f.explanation_tr),
    f.why && h('p', { class: 'explain src-tag' }, `Neden puana katılmadı: ${f.why}.`));
  if (showJump) {
    const b = h('button', { class: 'quiet', type: 'button', 'aria-label': `Sayfada göster: ${f.categoryLabel}` }, 'Sayfada göster');
    b.addEventListener('click', () => highlight(f.quote, b)); li.append(b);
  }
  return li;
}

function render(r, { quiet = false } = {}) {
  $('sonuc').hidden = false;
  const v = $('verdict'); v.dataset.verdict = r.verdict;
  $('verdict-title').textContent = VERDICT_TEXT[r.verdict].title;
  $('verdict-body').textContent = VERDICT_TEXT[r.verdict].body;
  $('score-num').textContent = r.score;
  $('score-word').textContent = r.level === 'low' ? 'düşük risk puanı' : r.level === 'medium' ? 'orta risk puanı' : 'yüksek risk puanı';
  $('track').setAttribute('aria-label', `Risk ölçeği: yüz üzerinden ${r.score}`);
  requestAnimationFrame(() => { $('marker').style.left = Math.min(100, Math.max(0, r.score)) + '%'; });
  $('coverage').textContent = `Metnin %${Math.round(r.meta.coverage * 100)}’i okundu · ${r.findings.length} madde alıntıyla doğrulandı · ${r.meta.llm ? 'yapay zekâ + kurallar' : 'hızlı tarama (yalnızca kurallar)'}`;

  const doubts = $('doubts'); doubts.replaceChildren(...r.doubts.map(d => h('li', {}, d)));

  const list = $('findings'); list.replaceChildren(...r.findings.map(f => findingItem(f, { showJump: IN_EXT && !(lastReport?.sources?.length > 1 || (lastReport?.sources?.[0] && lastReport.sources[0] !== tabUrl)) })));
  $('no-findings').hidden = r.findings.length > 0; $('findings-title').hidden = false;

  $('uncertain-wrap').hidden = !r.uncertain.length; $('uncertain-count').textContent = r.uncertain.length ? `(${r.uncertain.length})` : '';
  $('uncertain').replaceChildren(...r.uncertain.map(f => findingItem(f, { showJump: false })));

  $('rejected-wrap').hidden = !r.rejected.length; $('rejected-count').textContent = r.rejected.length ? `(${r.rejected.length})` : '';
  $('rejected').replaceChildren(...r.rejected.map(x => h('li', {}, x.reason, x.finding?.quote ? ` — “${String(x.finding.quote).slice(0, 120)}”` : '')));

  const inj = [...r.injection.map(i => `Görünür metinde: “${i.text}”`), ...r.hiddenSamples.map(s => `Gizli metin (${s.reason}): “${s.text.slice(0, 140)}”`)];
  $('injection-wrap').hidden = !inj.length; $('injection-count').textContent = inj.length ? `(${inj.length})` : '';
  $('injection').replaceChildren(...inj.map(t => h('li', {}, t)));

  if (!quiet) $('sonuc').focus({ preventScroll: false });
}


/* ---------- sayfada göster ---------- */
async function highlight(quote, btn) {
  const tab = await activeTab();
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [quote.slice(0, 90)], func: q => {
      const sel = getSelection(); sel.removeAllRanges(); return window.find(q, false, false, true, false, false, false); } });
    btn.textContent = r.result ? 'Sayfada işaretlendi' : 'Bu sayfada değil, şartlar sayfasındadır';
  } catch { btn.textContent = 'Sayfaya erişilemedi'; }
}

function announce(report) {   // yalnızca harness'te; uzantıda bunu arka plan yapar
  const text = spokenSummary(report);
  $('live').textContent = ''; setTimeout(() => { $('live').textContent = text; }, 50);
  if (prefs.sound) { playEarcon(report.verdict, prefs.volume); $('sound-caption').textContent = EARCON_CAPTION[report.verdict]; } else $('sound-caption').textContent = '';
}

/* ---------- başlat ---------- */
$('btn-read').addEventListener('click', rescan);
$('btn-sound').addEventListener('click', toggleSound);
$('btn-replay').addEventListener('click', () => {
  if (IN_EXT) chrome.runtime.sendMessage({ type: 'replay', tabId });
  else if (lastReport) { announce(lastReport); if (prefs.sound) speak(spokenSummary(lastReport)); }
});
$('btn-stop').addEventListener('click', () => IN_EXT ? chrome.runtime.sendMessage({ type: 'stop' }) : stopSpeaking());
$('btn-agent').addEventListener('click', async () => {
  busy(true); progress('Yapay zekâ ajanı bağlantıyı arıyor…');
  const r = await chrome.runtime.sendMessage({ type: 'find-agent', tabId, kind: 'terms' });
  if (!r?.ok) { busy(false); progress(r?.error || 'Bulunamadı'); }
});

(async () => {
  if (!IN_EXT) { paintSound(); $('page-host').textContent = 'önizleme: ' + (params.get('fixture') || 'happy'); return harnessScan(); }
  prefs = { ...prefs, ...((await chrome.storage.local.get('prefs')).prefs || {}) }; paintSound();
  const t = await activeTab(); if (t) { tabId = t.id; tabUrl = t.url; try { $('page-host').textContent = new URL(t.url).hostname; } catch {} $('page-title').textContent = t.title || ''; }
  await paintFromStore();
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'session' && (ch['r:' + tabId] || ch['s:' + tabId])) paintFromStore(); });
  chrome.tabs.onActivated.addListener(async () => { const t2 = await activeTab(); tabId = t2.id; tabUrl = t2.url; $('page-title').textContent = t2.title || ''; try { $('page-host').textContent = new URL(t2.url).hostname; } catch {} paintFromStore(); });
})();
