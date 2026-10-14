// Kategori sözlüğü, JSON şeması ve DETERMİNİSTİK doğrulama.
// LLM'in söylediği hiçbir şey, buradaki kontrollerden geçmeden rapora girmez.

export const CATEGORIES = {
  data_sale_sharing: { tr: 'Verilerin satışı veya üçüncü taraflarla paylaşımı', weight: 4,
    cue: /(sell|sale|sold|share|disclos|third[- ]part|partner|affiliate|advertis|sat[ıi]ş|sat[ıi]l|payla[şs]|üçüncü|ortak|reklam)/iu },
  tracking_profiling: { tr: 'İzleme, çerez ve profilleme', weight: 2,
    cue: /(track|cookie|pixel|profil|fingerprint|behaviou?r|analytics|izle|çerez|davran[ıi][şs])/iu },
  auto_renewal: { tr: 'Otomatik yenileme ve iptal zorluğu', weight: 3,
    cue: /(auto[- ]?renew|automatically (renew|charge|bill)|recurring|cancel|subscription|otomatik|yenilen|iptal|abonelik)/iu },
  unilateral_change: { tr: 'Şartları tek taraflı değiştirme hakkı', weight: 2,
    cue: /(modify|change|amend|update|revise|değiştir|güncelle|tadil)/iu },
  arbitration_waiver: { tr: 'Tahkim zorunluluğu / toplu dava hakkından vazgeçme', weight: 4,
    cue: /(arbitrat|class action|class[- ]wide|jury|waive|tahkim|toplu dava|feragat|mahkemeye)/iu },
  liability_limit: { tr: 'Şirketin sorumluluğunun sınırlanması', weight: 3,
    cue: /(liab|warrant|as is|as-is|indemnif|damages|sorumlu|tazminat|garanti|zarar)/iu },
  content_license: { tr: 'İçeriğiniz üzerinde geniş kullanım lisansı', weight: 3,
    cue: /(licen[cs]e|royalty|perpetual|irrevocable|sublicens|user content|lisans|telif|süresiz|geri alınamaz|içeri[ğg])/iu },
  account_termination: { tr: 'Hesabın gerekçesiz askıya alınması veya kapatılması', weight: 2,
    cue: /(terminat|suspend|discretion|without notice|askıya|kapat|sonlandır|bildirimsiz|takdir)/iu },
  data_retention: { tr: 'Uzun veya belirsiz süreli veri saklama', weight: 2,
    cue: /(retain|retention|store|indefinite|as long as|delete|sakla|silin|süresiz|muhafaza)/iu },
  refund_denied: { tr: 'Ücret iadesi yok veya sınırlı', weight: 3,
    cue: /(refund|non-refundable|no refund|chargeback|iade|geri ödeme)/iu },
  jurisdiction: { tr: 'Yabancı mahkeme yetkisi / uygulanacak hukuk', weight: 1,
    cue: /(governing law|jurisdiction|venue|courts? of|governed by|yetkili|uygulanacak hukuk|mahkeme)/iu },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);
export const DOC_TYPES = ['terms_of_service', 'privacy_policy', 'subscription_terms', 'mixed', 'not_legal_text'];
export const SEVERITY_TR = { 1: 'Düşük', 2: 'Orta', 3: 'Yüksek' };

export const MIN_QUOTE = 20;   // çok kısa alıntı = kanıt değil
export const MAX_QUOTE = 420;
export const MIN_CONFIDENCE = 0.55;

// LLM'e verilen şema (dokümantasyon + response_format için)
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['document_type', 'findings'],
  properties: {
    document_type: { enum: DOC_TYPES },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['segment_id', 'category', 'severity', 'quote', 'explanation_tr', 'confidence'],
        properties: {
          segment_id: { type: 'integer', minimum: 0 },
          category: { enum: CATEGORY_IDS },
          severity: { type: 'integer', minimum: 1, maximum: 3 },
          quote: { type: 'string', minLength: MIN_QUOTE, maxLength: MAX_QUOTE },
          explanation_tr: { type: 'string', minLength: 10, maxLength: 420 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

/** Boşluk, tipografik tırnak ve büyük/küçük harf farklarını yok sayarak karşılaştırma için normalleştirir. */
export function norm(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u00AD|\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr');
}

export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new Error('Yanıt metin değil');
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('JSON bulunamadı');
  return JSON.parse(t.slice(a, b + 1));
}

/**
 * Ham LLM çıktısını doğrular.
 * @returns {{documentType, accepted[], uncertain[], rejected[]}}
 *  accepted  : alıntısı metinde BİREBİR bulunan, şemaya uyan, güveni yeterli maddeler (skora girer)
 *  uncertain : şemaya ve alıntıya uyuyor ama güven düşük / kategori ipucu alıntıda yok (skora girmez, kullanıcıya gösterilir)
 *  rejected  : geçersiz (alıntı bulunamadı, şema hatası...) — atıldı, nedeni kayıtlı
 */
export function validate(raw, segments) {
  const out = { documentType: 'not_legal_text', accepted: [], uncertain: [], rejected: [] };
  let obj = raw;
  if (typeof raw === 'string') obj = parseJsonLoose(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Kök nesne değil');
  out.documentType = DOC_TYPES.includes(obj.document_type) ? obj.document_type : 'not_legal_text';
  if (!Array.isArray(obj.findings)) throw new Error('findings dizisi yok');

  const byId = new Map(segments.map(s => [s.id, s]));
  const normCache = new Map();
  const segNorm = id => {
    if (!normCache.has(id)) normCache.set(id, norm(byId.get(id).text));
    return normCache.get(id);
  };
  const seen = new Map();

  for (const f of obj.findings) {
    const rej = reason => out.rejected.push({ reason, finding: f });
    if (!f || typeof f !== 'object') { rej('Madde nesne değil'); continue; }
    if (!Number.isInteger(f.segment_id) || !byId.has(f.segment_id)) { rej('Geçersiz segment numarası'); continue; }
    if (!CATEGORY_IDS.includes(f.category)) { rej('Bilinmeyen kategori'); continue; }
    if (!Number.isInteger(f.severity) || f.severity < 1 || f.severity > 3) { rej('Geçersiz önem derecesi'); continue; }
    if (typeof f.quote !== 'string') { rej('Alıntı yok'); continue; }
    if (typeof f.explanation_tr !== 'string' || f.explanation_tr.trim().length < 10) { rej('Açıklama yok'); continue; }
    const conf = typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1 ? f.confidence : null;
    if (conf === null) { rej('Geçersiz güven değeri'); continue; }

    const q = norm(f.quote);
    if (q.length < MIN_QUOTE) { rej('Alıntı çok kısa'); continue; }
    if (f.quote.length > MAX_QUOTE) { rej('Alıntı çok uzun'); continue; }
    if (!segNorm(f.segment_id).includes(q)) { rej('Alıntı, belirtilen segmentte birebir bulunamadı'); continue; }

    const clean = {
      segment_id: f.segment_id, category: f.category, severity: f.severity,
      quote: f.quote.trim(), explanation_tr: f.explanation_tr.trim().slice(0, 420),
      confidence: conf, source: f.source === 'rule' ? 'rule' : 'llm',
    };
    const cueOk = CATEGORIES[f.category].cue.test(f.quote);
    if (conf < MIN_CONFIDENCE) { out.uncertain.push({ ...clean, why: 'Model bu maddeden emin değil' }); continue; }
    if (!cueOk) { out.uncertain.push({ ...clean, why: 'Alıntı, seçilen kategoriyi açıkça desteklemiyor' }); continue; }

    const key = f.segment_id + ':' + f.category;
    const prev = seen.get(key);
    if (prev) { if (clean.severity > prev.severity) Object.assign(prev, clean); continue; }
    seen.set(key, clean);
    out.accepted.push(clean);
  }
  return out;
}

/** Skor tamamen koddadır: LLM skor üretmez. */
export function computeScore(findings) {
  const perCat = {};
  for (const f of findings) {
    const w = CATEGORIES[f.category]?.weight ?? 1;
    perCat[f.category] = Math.min((perCat[f.category] || 0) + w * f.severity, w * 3 * 1.5);
  }
  const raw = Object.values(perCat).reduce((a, b) => a + b, 0);
  return Math.round(100 * (1 - Math.exp(-raw / 22)));
}

export function levelOf(score) { return score < 25 ? 'low' : score < 55 ? 'medium' : 'high'; }
