// Deterministik "tripwire" kuralları. İki işi var:
// 1) LLM'in atladığı çok belirgin maddeleri yakalamak (özellikle enjeksiyonla "risk yok de" denirse)
// 2) Eval'de LLM'siz taban çizgisi olmak.
// Yalnızca yüksek kesinlikli kalıplar: kaçırma kabul, yanlış alarm istemiyoruz.

export const RULES = [
  { category: 'arbitration_waiver', severity: 3,
    re: /(waive[^.]{0,80}(class action|jury)|(class action|class[- ]wide)[^.]{0,60}(waiver|waive|not (be )?permitted)|binding arbitration|toplu dava[^.]{0,60}(feragat|vazgeç)|zorunlu tahkim)/iu,
    tr: 'Anlaşmazlıkta mahkemeye gitme veya toplu dava açma hakkınızdan vazgeçmiş sayılabilirsiniz; çözüm özel bir tahkim sürecine bırakılıyor.' },
  { category: 'data_sale_sharing', severity: 3,
    re: /(we (may |can |will )?(sell|rent)[^.]{0,60}(personal )?(data|information)|sell(ing)? your (personal )?(data|information)|kişisel verilerinizi[^.]{0,60}(satabilir|satış))/iu,
    tr: 'Kişisel verilerinizin satılabileceği veya kiralanabileceği belirtiliyor.' },
  { category: 'auto_renewal', severity: 2,
    re: /(automatically renew|auto[- ]renew|will be (automatically )?charged[^.]{0,60}(each|every|until you cancel)|otomatik (olarak )?yenilen|iptal edilmedi[ğg]i sürece[^.]{0,40}yenilen)/iu,
    tr: 'Abonelik, siz iptal etmedikçe otomatik yenileniyor ve her dönem ücretlendirilebilirsiniz.' },
  { category: 'refund_denied', severity: 2,
    re: /(non-?refundable|no refunds?|not (be )?entitled to (a )?refund|iade (edilmez|yapılmaz)|ücret iadesi (yapılmaz|söz konusu değildir))/iu,
    tr: 'Ödediğiniz ücretin iade edilmeyeceği belirtiliyor.' },
  { category: 'content_license', severity: 3,
    re: /((perpetual|irrevocable|worldwide)[^.]{0,80}(royalty-free|sublicens)|(süresiz|geri alınamaz)[^.]{0,80}(lisans|kullanım hakkı))/iu,
    tr: 'Paylaştığınız içerik için şirkete süresiz, geri alınamaz ve geniş bir kullanım izni veriyorsunuz.' },
  { category: 'unilateral_change', severity: 2,
    re: /((reserve|right)[^.]{0,40}(modify|change|amend|update)[^.]{0,60}(at any time|without (prior )?notice|sole discretion)|dilediği zaman[^.]{0,60}(değiştirme|değiştirebilir)|önceden bildirim(sizin|de bulunmaksızın)[^.]{0,40}değiştir)/iu,
    tr: 'Şirket şartları istediği zaman, çoğu kez haber vermeden değiştirebileceğini söylüyor.' },
  { category: 'account_termination', severity: 2,
    re: /(terminate|suspend)[^.]{0,80}(at any time|sole discretion|without (prior )?notice)|(askıya al|sonlandır|kapat)[^.]{0,60}(dilediği zaman|bildirimsiz|önceden bildirim(de bulunmaksızın|siz))/iu,
    tr: 'Hesabınız gerekçe gösterilmeden veya haber verilmeden kapatılabilir.' },
];

export function ruleScan(segments) {
  const out = [];
  for (const s of segments) {
    for (const r of RULES) {
      const m = s.text.match(r.re);
      if (!m) continue;
      // alıntı: eşleşmeyi içeren cümle (en fazla 400 karakter)
      const idx = m.index;
      const start = Math.max(s.text.lastIndexOf('. ', idx) + 2, 0);
      let end = s.text.indexOf('. ', idx + m[0].length);
      end = end < 0 ? s.text.length : end + 1;
      let quote = s.text.slice(start, end).trim();
      if (quote.length > 400) quote = s.text.slice(idx, idx + 400).trim();
      if (quote.length < 20) quote = s.text.slice(Math.max(0, idx - 40), idx + m[0].length + 40).trim();
      out.push({ segment_id: s.id, category: r.category, severity: r.severity, quote,
        explanation_tr: r.tr, confidence: 0.9, source: 'rule' });
    }
  }
  return out;
}
