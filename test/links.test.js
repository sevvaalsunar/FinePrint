import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findLegalLinks, siteKey } from '../src/links.js';

const page = (url, body) => new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url, pretendToBeVisual: true });

test('siteKey: .com.tr ve alt alan adları doğru', () => {
  assert.equal(siteKey('www.amazon.com.tr'), 'amazon.com.tr');
  assert.equal(siteKey('open.spotify.com'), 'spotify.com');
  assert.equal(siteKey('www.trendyol.com'), 'trendyol.com');
  assert.notEqual(siteKey('evil.com.tr'), siteKey('amazon.com.tr'));
});

test('Amazon benzeri footer: "Kullanım ve Satış Koşulları" + "Gizlilik Bildirimi"', async () => {
  const d = page('https://www.amazon.com.tr/', `<footer>
    <a href="/gp/help/customer/display.html?nodeId=201909000">Kullanım ve Satış Koşulları</a>
    <a href="/gp/help/customer/display.html?nodeId=201909010">Gizlilik Bildirimi</a>
    <a href="https://evil.com.tr/kvkk">KVKK</a></footer>`);
  const r = await findLegalLinks({ doc: d.window.document, waitMs: 0 });
  assert.match(r.terms.href, /201909000/); assert.match(r.privacy.href, /201909010/);
});

test('Spotify benzeri: open.spotify.com üzerinde "Yasal" ve "Gizlilik Merkezi" www.spotify.com\'a gider', async () => {
  const d = page('https://open.spotify.com/', `<nav><a href="https://www.spotify.com/tr/legal/">Yasal</a>
    <a href="https://www.spotify.com/tr/privacy">Gizlilik Merkezi</a><a href="/premium">Premium'u keşfet</a></nav>`);
  const r = await findLegalLinks({ doc: d.window.document, waitMs: 0 });
  assert.equal(r.terms.href, 'https://www.spotify.com/tr/legal/'); assert.equal(r.privacy.href, 'https://www.spotify.com/tr/privacy');
});

test('Trendyol benzeri: footer sonradan çizilir, bekleyip bulur (abonelik/mesafeli satış dahil)', async () => {
  const d = page('https://www.trendyol.com/', `<div id="app">Yükleniyor</div>`);
  setTimeout(() => { d.window.document.body.insertAdjacentHTML('beforeend', `<footer>
    <a href="/kullanim-kosullari">Kullanım Koşulları</a><a href="/kisisel-verilerin-korunmasi">Kişisel Verilerin Korunması</a>
    <a href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</a></footer>`); }, 300);
  const r = await findLegalLinks({ doc: d.window.document, waitMs: 3000 });
  assert.ok(r.terms && r.privacy && r.subscription, JSON.stringify(r));
});

test('bozuk %-kodlu adres aramayı çökertmez; shadow DOM içi bulunur', async () => {
  const d = page('https://example.com.tr/', `<a href="/%E0%A4%A">kötü</a><div id="host"></div>`);
  const sr = d.window.document.getElementById('host').attachShadow({ mode: 'open' });
  sr.innerHTML = '<a href="/gizlilik-politikasi">Gizlilik Politikası</a>';
  const r = await findLegalLinks({ doc: d.window.document, waitMs: 0 });
  assert.equal(r.privacy.href, 'https://example.com.tr/gizlilik-politikasi');
});

test('yanlış alarm yok: alakasız bağlantılar ve düz metin', async () => {
  const d = page('https://www.example.com/', `<p>Gizlilik bizim için önemlidir.</p><a href="/kariyer">Kariyer</a><a href="/yardim">Yardım</a>`);
  const r = await findLegalLinks({ doc: d.window.document, waitMs: 0 });
  assert.deepEqual(r, {});
});
