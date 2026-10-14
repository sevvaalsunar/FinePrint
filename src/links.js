// Sitedeki sözleşme / gizlilik / abonelik bağlantılarını bulur.
// chrome.scripting ile sayfaya serileştirilerek gönderilir: TAMAMEN kendi içinde olmalı.
// - Sonradan çizilen menü/footer için MutationObserver ile bekler (en fazla waitMs)
// - İstenirse sayfayı adım adım aşağı kaydırır (yalnızca kullanıcının görmediği gizli sekmede)
// - Shadow DOM içine de bakar; bozuk %-kodlu adres aramayı çökertmez
export async function findLegalLinks(opts) {
  const { waitMs = 5000, scroll = false, doc: d0 } = opts || {};
  const doc = d0 || document;
  const win = doc.defaultView || window;
  const loc = doc.location || win.location;

  const TWO_PART = /^(com|net|org|gov|edu|gen|bel|biz|av|web|k12|tv|co|ac|ne|or|go|gob|nic)\.[a-z]{2}$/;
  const siteKey = h => {
    const p = String(h).toLowerCase().replace(/^www\./, '').split('.');
    const last2 = p.slice(-2).join('.');
    return TWO_PART.test(last2) ? p.slice(-3).join('.') : last2;
  };
  const me = siteKey(loc.hostname);
  const brand = me.split('.')[0];

  const KINDS = {
    terms: [
      [/kullan[ıi]m (ve sat[ıi][şs] )?(ko[şs]ul|[şs]art)/, 10], [/(üyelik|kullan[ıi]c[ıi]|hizmet|sat[ıi][şs]) sözle[şs]me/, 10],
      [/hizmet (ko[şs]ul|[şs]art)|[şs]artlar ve ko[şs]ul|sat[ıi][şs] ko[şs]ul/, 9], [/conditions of (use|sale)|terms of (use|service)|user agreement|terms and conditions/, 10],
      [/^(yasal|legal|terms|[şs]artlar|sözle[şs]meler|yasal bilgiler)$/, 7], [/\/(legal|terms|tos|kullanim-kosullari|uyelik-sozlesmesi|sozlesme)/, 5],
    ],
    privacy: [
      [/gizlilik (politika|bildirim|sözle[şs]me|merkez|ilke)/, 10], [/ki[şs]isel veri|ayd[ıi]nlatma|kvkk/, 10],
      [/privacy (policy|notice|statement|center|centre)/, 10], [/^gizlilik$|^privacy$/, 8], [/çerez politika|cookie (policy|notice)/, 6],
      [/\/(privacy|gizlilik|kvkk|kisisel-veri|aydinlatma)/, 5],
    ],
    subscription: [
      [/mesafeli sat[ıi][şs]|ön bilgilendirme/, 9], [/abonelik|premium (ko[şs]ul|[şs]art|plan)/, 7], [/iade (ko[şs]ul|politika|[şs]art)|iptal ve iade/, 8],
      [/subscription|refund|billing terms|cancellation/, 8], [/\/(subscription|refund|iade|mesafeli)/, 5],
    ],
  };

  const allAnchors = root => {
    const out = [...root.querySelectorAll('a[href]')];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...allAnchors(el.shadowRoot));
    return out;
  };
  const scan = () => {
    const best = {};
    for (const a of allAnchors(doc)) {
      let u; try { u = new URL(a.getAttribute('href'), loc.href); } catch { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      const k = siteKey(u.hostname);
      if (k !== me && !k.startsWith(brand)) continue;         // aynı site (ör. open.spotify.com ↔ www.spotify.com)
      let path = u.pathname; try { path = decodeURIComponent(path); } catch {}
      const txt = String(a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      const t = txt.toLocaleLowerCase('tr'), p = path.toLocaleLowerCase('tr');
      for (const [kind, rules] of Object.entries(KINDS)) {
        let s = 0;
        for (const [re, w] of rules) { if (re.test(t)) s = Math.max(s, w); else if (re.source.startsWith('\\/') && re.test(p)) s = Math.max(s, w); }
        if (!s) continue;
        if (txt.length > 60) s -= 2;                              // uzun cümle içindeki bağlantı daha az olası
        const href = u.href.split('#')[0];
        if (!best[kind] || s > best[kind].score) best[kind] = { href, text: txt, score: s };
      }
    }
    return best;
  };

  if (scroll) {                                                   // gizli sekmede tembel yüklenen footer'ı çağır
    for (let i = 0; i < 12; i++) { win.scrollTo(0, doc.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 350)); }
  }
  let found = scan();
  if (Object.keys(found).length || !waitMs) return found;
  return await new Promise(res => {
    const done = () => { obs.disconnect(); clearTimeout(timer); res(scan()); };
    const obs = new win.MutationObserver(() => { const f = scan(); if (Object.keys(f).length) { found = f; done(); } });
    obs.observe(doc.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(done, waitMs);
  });
}

/** Ortak eTLD+1 benzeri anahtar (amazon.com.tr → amazon.com.tr, open.spotify.com → spotify.com) */
export function siteKey(h) {
  const p = String(h).toLowerCase().replace(/^www\./, '').split('.');
  const last2 = p.slice(-2).join('.');
  return /^(com|net|org|gov|edu|gen|bel|biz|av|web|k12|tv|co|ac|ne|or|go|gob|nic)\.[a-z]{2}$/.test(last2) ? p.slice(-3).join('.') : last2;
}

/** Bağlantı hiç bulunamazsa denenecek yaygın adresler (sunucuya HEAD/GET ile sorulur, içerik kontrol edilir) */
export const COMMON_PATHS = ['/legal', '/terms', '/terms-of-service', '/terms-of-use', '/privacy', '/privacy-policy',
  '/kullanim-kosullari', '/uyelik-sozlesmesi', '/gizlilik-politikasi', '/gizlilik', '/kvkk', '/kisisel-verilerin-korunmasi', '/aydinlatma-metni'];
