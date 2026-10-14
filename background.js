// Otomatik tarama: sayfa yüklenince çalışır. Ses (earcon + sesli okuma), simge rozeti ve panel verisi buradan gelir.
import { analyze, spokenSummary, VERDICT_TEXT } from './src/pipeline.js';
import { extractPageText } from './src/extract.js';
import { directTransport } from './src/llm.js';
import { legalScore } from './src/guard.js';
import { LLM } from './config.js';
import { findLegalLinks, siteKey, COMMON_PATHS } from './src/links.js';

const HAS_LLM = !!(LLM.baseURL && LLM.apiKey && LLM.model);
const BADGE = { safe: ['✓', '#2b7358'], caution: ['!', '#8a5a0b'], high: ['!!', '#9a2f45'], uncertain: ['?', '#4f5f86'], scanning: ['…', '#566663'], none: ['', '#566663'] };
const LEGAL_URL = /(terms|tos|privacy|gizlilik|kullanim|kullanım|sartlar|şartlar|koşul|kosul|kvkk|aydinlatma|aydınlatma|legal|policy)/i;
const internalTabs = new Set();
const running = new Set();
const DAY = 24 * 3600 * 1000;

chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}));

const getPrefs = async () => ({ sound: true, volume: 0.8, ...((await chrome.storage.local.get('prefs')).prefs || {}) });
const setBadge = (tabId, key) => { const [t, c] = BADGE[key] || BADGE.none; chrome.action.setBadgeText({ tabId, text: t }); chrome.action.setBadgeBackgroundColor({ tabId, color: c }); };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const site = u => siteKey(host(u));

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Sonuç sesi çalmak' });
}
async function announce(report) {
  const p = await getPrefs(); if (!p.sound) return;
  try { await ensureOffscreen(); await chrome.runtime.sendMessage({ type: 'earcon', verdict: report.verdict, volume: p.volume }); } catch {}
  setTimeout(() => { chrome.tts.stop(); chrome.tts.speak(spokenSummary(report), { lang: 'tr-TR', rate: 0.95, volume: p.volume }); }, 900);
}

const run = (tabId, func, args = []) => chrome.scripting.executeScript({ target: { tabId }, func, args }).then(r => r?.[0]?.result);


function waitComplete(tabId, ms = 20000) {
  return new Promise(res => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); res(false); }, ms);
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(fn); res(true); } };
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function inHiddenTab(url, fn, args = []) {   // kullanıcının görmediği bir sekmede açar, çalıştırır, kapatır
  const tab = await chrome.tabs.create({ url, active: false }); internalTabs.add(tab.id);
  try { await waitComplete(tab.id); await new Promise(r => setTimeout(r, 1500)); return await run(tab.id, fn, args); }
  finally { internalTabs.delete(tab.id); chrome.tabs.remove(tab.id).catch(() => {}); }
}
const readInBackground = url => inHiddenTab(url, extractPageText);

async function probeCommonPaths(origin) {   // son çare: yaygın yasal adresleri sunucuya sor, içeriği kontrol et
  const tries = COMMON_PATHS.map(async path => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(origin + path, { credentials: 'omit', redirect: 'follow', signal: ctl.signal });
      if (!r.ok || siteKey(new URL(r.url).hostname) !== siteKey(new URL(origin).hostname)) return null;
      const txt = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
      const sc = legalScore(txt);
      return sc >= 4 ? { href: r.url, text: path, score: sc } : null;
    } catch { return null; } finally { clearTimeout(t); }
  });
  const ok = (await Promise.all(tries)).filter(Boolean).sort((a, b) => b.score - a.score);
  return ok.filter((x, i, a) => a.findIndex(y => y.href === x.href) === i).slice(0, 2);
}

async function save(tabId, report) {
  await chrome.storage.session.set({ ['r:' + tabId]: report, ['s:' + tabId]: report.state || 'done' });
  setBadge(tabId, report.verdict || 'none');
}

async function scanTab(tabId, url, { force = false, speak = true } = {}) {
  if (running.has(tabId)) return; running.add(tabId);
  try {
    const h = host(url);
    const cacheKey = 'c:' + h + ':' + (LEGAL_URL.test(url) ? new URL(url).pathname : '');
    if (!force) {
      const c = (await chrome.storage.local.get(cacheKey))[cacheKey];
      if (c && Date.now() - c.at < DAY) {
        await save(tabId, c.report);
        const seen = (await chrome.storage.session.get('seen:' + h))['seen:' + h];
        if (!seen) { await chrome.storage.session.set({ ['seen:' + h]: 1 }); if (speak) announce(c.report); }
        return;
      }
    }
    await chrome.storage.session.set({ ['s:' + tabId]: 'scanning' }); setBadge(tabId, 'scanning');
    const here = await run(tabId, extractPageText);
    let extracted = here, sources = [url];
    const isLegalPage = here && (LEGAL_URL.test(url) && legalScore(here.text) >= 3 || (legalScore(here.text) >= 5 && here.charCount > 2500));
    const trace = [];
    if (isLegalPage) trace.push('Bu sayfa bir şartlar metni; doğrudan okundu.');
    if (!isLegalPage) {
      // 1) açık sayfada ara (sonradan çizilen menü/footer için 5 sn bekler)
      let links = await run(tabId, findLegalLinks, [{ waitMs: 5000 }]).catch(() => null) || {};
      trace.push(`Açık sayfada ${Object.keys(links).length} sözleşme bağlantısı bulundu.`);
      // 2) bulunamazsa: aynı sayfayı gizli sekmede aç, sonuna kadar kaydır (tembel yüklenen footer), tekrar ara
      if (!Object.keys(links).length) {
        links = await inHiddenTab(url, findLegalLinks, [{ waitMs: 4000, scroll: true }]).catch(() => null) || {};
        trace.push(`Gizli sekmede sayfa sonuna kadar kaydırıldı: ${Object.keys(links).length} bağlantı.`);
      }
      let picks = ['terms', 'privacy', 'subscription'].map(k => links[k]).filter(Boolean)
        .filter((l, i, a) => a.findIndex(x => x.href === l.href) === i).slice(0, 3);
      // 3) yine yoksa: yaygın yasal adresleri dene (/legal, /privacy, /kvkk ...)
      if (!picks.length) {
        picks = await probeCommonPaths(new URL(url).origin);
        trace.push(`Yaygın yasal adresler denendi: ${picks.length} sayfa bulundu.`);
      }
      if (!picks.length) { await save(tabId, { state: 'none', verdict: null, meta: { url }, trace }); return; }
      // "Yasal" / "Legal" gibi dizin sayfalarına bir adım daha gir: asıl sözleşme bağlantılarını oradan al
      const HUB = /^(yasal|legal|sözle[şs]meler|yasal bilgiler|legal center|legal information)$/i;
      const expanded = [];
      for (const l of picks) {
        if (!HUB.test(l.text || '')) { expanded.push(l); continue; }
        const inner = await inHiddenTab(l.href, findLegalLinks, [{ waitMs: 3000 }]).catch(() => null) || {};
        const sub = ['terms', 'privacy', 'subscription'].map(k => inner[k]).filter(x => x && x.href !== l.href);
        trace.push(`Dizin sayfası “${l.text}” açıldı: ${sub.length} sözleşme bağlantısı.`);
        expanded.push(...(sub.length ? sub : [l]));
      }
      picks = expanded.filter((l, i, a) => a.findIndex(x => x.href === l.href) === i).slice(0, 3);
      const docs = [];
      for (const l of picks) {
        const d = await readInBackground(l.href).catch(() => null);
        const ok = d?.charCount > 300 && legalScore(d.text) >= 2;
        trace.push(`${ok ? 'Okundu' : 'Okunamadı'}: “${l.text || l.href}” (${host(l.href)})`);
        if (ok) docs.push({ l, d });
      }
      if (!docs.length) { await save(tabId, { state: 'none', verdict: null, meta: { url }, trace }); return; }
      extracted = { url, title: here.title, charCount: 0, hiddenChars: 0, hiddenSamples: [], text: '' };
      for (const { l, d } of docs) {
        extracted.text += `\n${l.text || 'Şartlar'}\n${d.text}\n`; extracted.hiddenChars += d.hiddenChars; extracted.hiddenSamples.push(...d.hiddenSamples);
      }
      extracted.charCount = extracted.text.length; sources = docs.map(x => x.l.href);
    }
    const report = await analyze(extracted, { settings: LLM, useLLM: HAS_LLM, transport: HAS_LLM ? directTransport(LLM) : null });
    report.sources = sources; report.state = 'done'; report.meta.url = url; report.trace = trace;
    await chrome.storage.local.set({ [cacheKey]: { at: Date.now(), report } });
    await chrome.storage.session.set({ ['seen:' + h]: 1 });
    await save(tabId, report);
    if (speak) announce(report);
  } catch (e) {
    await save(tabId, { state: 'error', verdict: null, error: String(e.message || e), meta: { url } });
  } finally { running.delete(tabId); }
}

/* --- otomatik tetik: aktif sekmede sayfa yüklenince --- */
const timers = new Map();
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !/^https?:/.test(tab.url || '') || internalTabs.has(tabId) || !tab.active) return;
  clearTimeout(timers.get(tabId)); timers.set(tabId, setTimeout(() => scanTab(tabId, tab.url), 1500));
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const s = (await chrome.storage.session.get('r:' + tabId))['r:' + tabId];
  setBadge(tabId, s?.verdict || (s?.state === 'scanning' ? 'scanning' : 'none'));
  if (!s) { const t = await chrome.tabs.get(tabId); if (/^https?:/.test(t.url || '') && t.status === 'complete') scanTab(tabId, t.url); }
});
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(['r:' + tabId, 's:' + tabId]));

/* --- klavye kısayolu: sonucu sesli oku --- */
chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== 'read-result') return;
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const r = t && (await chrome.storage.session.get('r:' + t.id))['r:' + t.id];
  const text = r?.verdict ? spokenSummary(r) : r?.state === 'none' ? 'Bu sayfada okunacak bir şartlar bağlantısı bulunamadı.' : 'Bu sayfa için henüz sonuç yok.';
  chrome.tts.stop(); chrome.tts.speak(text, { lang: 'tr-TR', rate: 0.95 });
});

/* --- panelden gelen istekler --- */
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    if (msg.type === 'scan') { await scanTab(msg.tabId, msg.url, { force: true }); return send({ ok: true }); }
    if (msg.type === 'replay') { const r = (await chrome.storage.session.get('r:' + msg.tabId))['r:' + msg.tabId]; if (r?.verdict) announce(r); return send({ ok: true }); }
    if (msg.type === 'stop') { chrome.tts.stop(); return send({ ok: true }); }
    if (msg.type === 'find-agent') {      // yedek: bağlantı bulunamadıysa page-agent ile ara
      if (!HAS_LLM) return send({ ok: false, error: 'Yapay zekâ yapılandırılmamış' });
      try {
        const before = (await chrome.tabs.get(msg.tabId)).url;
        await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['vendor/agent.js'] });
        const nav = waitComplete(msg.tabId, 60000);
        const agent = chrome.scripting.executeScript({ target: { tabId: msg.tabId }, args: [msg.kind || 'terms', { baseURL: LLM.baseURL, model: LLM.model }],
          func: (k, cfg) => globalThis.__inceYazi.findLegal(k, cfg) }).catch(() => null);
        await Promise.race([agent, nav]); await new Promise(r => setTimeout(r, 1200));
        const after = await chrome.tabs.get(msg.tabId);
        if (after.url === before) return send({ ok: false, error: 'Bağlantı bulunamadı' });
        if (site(after.url) !== site(before)) return send({ ok: false, error: 'Ajan başka bir siteye gitti: ' + host(after.url) });
        await scanTab(msg.tabId, after.url, { force: true }); return send({ ok: true });
      } catch (e) { return send({ ok: false, error: String(e.message || e) }); }
    }
    if (msg.type === 'llm-fetch') {      // page-agent'in customFetch'i: anahtar yalnızca burada
      try {
        const t = new URL(msg.url), a = new URL(LLM.baseURL);
        if (t.origin !== a.origin || !t.pathname.startsWith(a.pathname.replace(/\/+$/, ''))) return send({ ok: false, status: 0, error: 'İzin verilmeyen adres' });
        const res = await fetch(msg.url, { method: msg.init?.method || 'POST', headers: { ...(msg.init?.headers || {}), Authorization: `Bearer ${LLM.apiKey}` }, body: msg.init?.body });
        return send({ ok: true, status: res.status, statusText: res.statusText, body: await res.text() });
      } catch (e) { return send({ ok: false, status: 0, error: String(e.message || e) }); }
    }
    send({ ok: false });
  })();
  return true;
});
