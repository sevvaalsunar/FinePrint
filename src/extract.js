// Sayfadan metin çıkarır. chrome.scripting.executeScript({func}) ile sayfaya serileştirilerek gönderilir,
// bu yüzden TAMAMEN kendi içinde olmalı (dış import / dış değişken yok).
// Gizli metin (display:none, opacity:0, font-size:0, ekran dışı, arka planla aynı renk...) ÇIKARILMAZ:
// prompt injection'ın en yaygın taşıyıcısı budur. Ne kadar gizli metin atıldığı rapora yazılır.
export function extractPageText(doc) {
  doc = doc || document;
  const win = doc.defaultView || window;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'BUTTON']);
  const BLOCK = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'TR', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'DD', 'DT', 'PRE', 'TD', 'TH', 'SUMMARY', 'MAIN', 'BR', 'UL', 'OL', 'TABLE']);

  const parseColor = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const bgOf = el => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = parseColor(win.getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.95) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const hiddenReason = el => {
    for (let e = el; e && e.nodeType === 1 && e !== doc.documentElement; e = e.parentElement) {
      if (e.hasAttribute('hidden') && e.tagName !== 'DETAILS') return 'hidden';
      if (e.getAttribute('aria-hidden') === 'true') return 'aria-hidden';
      const cs = win.getComputedStyle(e);
      if (cs.display === 'none') {
        // kapalı <details> meşru bir daraltmadır; onun dışındaki display:none gizli metindir
        return e.closest && e.closest('details') ? null : 'display-none';
      }
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return 'visibility';
      if (parseFloat(cs.opacity) < 0.05) return 'opacity';
      if (parseFloat(cs.fontSize) < 2) return 'font-size';
      if ((cs.position === 'absolute' || cs.position === 'fixed') &&
          (parseFloat(cs.left) < -900 || parseFloat(cs.top) < -900 || parseFloat(cs.right) < -900)) return 'offscreen';
      if (parseFloat(cs.textIndent) < -900) return 'offscreen';
      if (cs.overflow === 'hidden' && (parseFloat(cs.height) === 0 || parseFloat(cs.width) === 0)) return 'zero-size';
      if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(100%)') return 'clipped';
    }
    const cs = win.getComputedStyle(el);
    const fg = parseColor(cs.color), bg = bgOf(el);
    if (fg && fg.a > 0.9 && Math.abs(fg.r - bg.r) + Math.abs(fg.g - bg.g) + Math.abs(fg.b - bg.b) < 12) return 'same-color';
    return null;
  };

  // kök: en çok metni olan main/article; yoksa body
  const cands = [...doc.querySelectorAll('main, article, [role="main"], #terms, #privacy, .terms, .privacy-policy, .legal')];
  let root = doc.body;
  let best = 0;
  for (const c of cands) { const n = (c.textContent || '').length; if (n > best) { best = n; root = c; } }
  if (root !== doc.body && best < (doc.body.textContent || '').length * 0.3) root = doc.body;

  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const parts = [];
  const hiddenSamples = [];
  let hiddenChars = 0, lastBlock = null;
  const cache = new WeakMap();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const txt = n.nodeValue.replace(/\s+/g, ' ');
    if (!txt.trim()) continue;
    const el = n.parentElement;
    if (!el) continue;
    let skip = false;
    for (let e = el; e && e !== root.parentElement; e = e.parentElement) {
      if (SKIP.has(e.tagName.toUpperCase())) { skip = true; break; }
      if (root === doc.body && /^(NAV|HEADER|FOOTER|ASIDE)$/.test(e.tagName)) { skip = true; break; }
    }
    if (skip) continue;
    let reason;
    if (cache.has(el)) reason = cache.get(el); else { reason = hiddenReason(el); cache.set(el, reason); }
    if (reason) {
      hiddenChars += txt.trim().length;
      if (hiddenSamples.length < 6) hiddenSamples.push({ reason, text: txt.trim().slice(0, 200) });
      continue;
    }
    let b = el; while (b && !BLOCK.has(b.tagName.toUpperCase())) b = b.parentElement;
    if (b !== lastBlock) { parts.push('\n'); lastBlock = b; }
    parts.push(txt);
  }
  const text = parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ ]{2,}/g, ' ').trim();
  return {
    url: doc.location ? doc.location.href : '', title: doc.title || '', lang: doc.documentElement.lang || '',
    text, charCount: text.length, hiddenChars, hiddenSamples,
  };
}
