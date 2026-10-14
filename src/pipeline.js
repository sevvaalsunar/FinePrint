import { CATEGORIES, SEVERITY_TR, validate, computeScore, levelOf } from './schema.js';
import { scanInjection, legalScore } from './guard.js';
import { ruleScan } from './rules.js';
import { segmentText, batchSegments } from './segment.js';
import { buildRequest } from './llm.js';

/**
 * Veri akışı:
 * extract → segment → injection tarama/sansür → LLM (parti parti) → şema + alıntı doğrulama
 *        → kural taraması (LLM'in atladıklarını tamamlar) → skor (kodda) → karar → rapor
 */
export async function analyze(extracted, { settings, transport, onProgress = () => {}, useLLM = true }) {
  const { segments, truncated, totalChars, sourceChars } = segmentText(extracted.text);

  // 1) Enjeksiyon: talimat benzeri kalıpları LLM'e gitmeden önce sansürle
  const injection = [];
  for (const s of segments) {
    const r = scanInjection(s.text);
    s.safeText = r.redacted;
    for (const h of r.hits) injection.push({ segment_id: s.id, text: h });
  }

  // 2) LLM
  let accepted = [], uncertain = [], rejected = [], docTypes = [], failedBatches = 0, analyzedChars = 0;
  const batches = useLLM ? batchSegments(segments) : [];
  for (let i = 0; i < batches.length; i++) {
    onProgress({ stage: 'llm', done: i, total: batches.length });
    const batch = batches[i];
    let ok = false, lastErr = '';
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const content = await transport(buildRequest(settings, batch));
        const v = validate(content, batch);
        accepted.push(...v.accepted); uncertain.push(...v.uncertain); rejected.push(...v.rejected);
        docTypes.push(v.documentType);
        analyzedChars += batch.reduce((n, s) => n + s.text.length, 0);
        ok = true;
      } catch (e) { lastErr = String(e.message || e); }
    }
    if (!ok) { failedBatches++; rejected.push({ reason: 'Parti işlenemedi: ' + lastErr, finding: null }); }
  }
  onProgress({ stage: 'rules', done: batches.length, total: batches.length });

  // 3) Kural taraması: LLM'in bulmadığı belirgin maddeleri ekle
  const rv = validate({ document_type: 'mixed', findings: ruleScan(segments) }, segments);
  const have = new Set(accepted.map(f => f.segment_id + ':' + f.category));
  const ruleAdded = rv.accepted.filter(f => !have.has(f.segment_id + ':' + f.category));
  accepted.push(...ruleAdded);
  if (!useLLM) analyzedChars = totalChars;

  // 4) Skor ve karar (tamamen kod)
  accepted.sort((a, b) => b.severity - a.severity || b.confidence - a.confidence || a.segment_id - b.segment_id);
  const score = computeScore(accepted);
  const level = levelOf(score);
  const coverage = sourceChars ? Math.min(1, analyzedChars / sourceChars) : 0;

  const doubts = [];
  const nonLegal = docTypes.length > 0 && docTypes.every(t => t === 'not_legal_text');
  if (!useLLM) doubts.push('Yapay zekâ kapalı; yalnızca en belirgin kalıplar tarandı. Bu yüzden “risk yok” diyemem.');
  if (extracted.charCount < 600) doubts.push('Metin çok kısa; sayfa eksik okunmuş olabilir.');
  if (legalScore(extracted.text) < 2 || nonLegal) doubts.push('Bu sayfa bir şartlar veya gizlilik metni gibi görünmüyor.');
  if (truncated) doubts.push('Metin çok uzun olduğu için yalnızca ilk bölümü okundu.');
  if (failedBatches) doubts.push(`${failedBatches} bölüm model hatası nedeniyle okunamadı.`);
  if (coverage < 0.9 && !truncated && !failedBatches && useLLM) doubts.push('Metnin tamamı analiz edilemedi.');
  if (uncertain.length >= 3) doubts.push(`${uncertain.length} madde için model veya doğrulama yeterince emin değil.`);
  if (extracted.hiddenChars > 0) doubts.push('Sayfada gizlenmiş metin bulundu ve analiz dışı bırakıldı.');
  if (injection.length) doubts.push('Metnin içinde yapay zekâya yönelik talimat benzeri ifadeler bulundu ve yok sayıldı.');

  let verdict;
  if (level === 'high') verdict = 'high';
  else if (level === 'medium') verdict = 'caution';
  else verdict = doubts.length ? (injection.length ? 'caution' : 'uncertain') : 'safe';
  if (verdict === 'safe' && accepted.some(f => f.severity === 3)) verdict = 'caution';

  return {
    meta: { url: extracted.url, title: extracted.title, analyzedAt: new Date().toISOString(), model: settings?.model || 'kurallar',
      coverage, segments: segments.length, chars: sourceChars, hiddenChars: extracted.hiddenChars, llm: useLLM },
    documentType: docTypes.find(t => t !== 'not_legal_text') || (nonLegal ? 'not_legal_text' : 'mixed'),
    score, level, verdict, doubts,
    findings: accepted.map((f, i) => ({ id: i + 1, ...f, categoryLabel: CATEGORIES[f.category].tr, severityLabel: SEVERITY_TR[f.severity] })),
    uncertain: uncertain.map(f => ({ ...f, categoryLabel: CATEGORIES[f.category].tr })),
    rejected, injection, hiddenSamples: extracted.hiddenSamples || [],
    stats: { ruleAdded: ruleAdded.length, rejected: rejected.length, failedBatches },
  };
}

export const VERDICT_TEXT = {
  safe: { title: 'Belirgin risk bulunmadı', body: 'Okunan metinde sık görülen riskli kalıplardan hiçbiri doğrulanamadı. Bu, metnin sorunsuz olduğu anlamına gelmez.' },
  caution: { title: 'Dikkat edilmesi gereken maddeler var', body: 'Aşağıdaki maddeleri kabul etmeden önce okumanız iyi olur.' },
  high: { title: 'Yüksek riskli maddeler var', body: 'Aşağıdaki maddeler haklarınızı ciddi biçimde sınırlıyor olabilir.' },
  uncertain: { title: 'Emin olamadım', body: 'Bu sonuca güvenmeyin; aşağıda nedenini yazdım. Metni kendiniz okuyun.' },
};

/** Sesli ve ekran okuyucu için kısa, nedenleri içeren özet. */
export function spokenSummary(report) {
  const t = VERDICT_TEXT[report.verdict].title;
  if (report.verdict === 'safe') return `${t}. Risk puanı yüz üzerinden ${report.score}. Hukuki tavsiye değildir.`;
  if (report.verdict === 'uncertain') return `${t}. ${report.doubts[0] || ''} Metni kendiniz okuyun.`;
  const top = report.findings.slice(0, 3).map(f => `${f.categoryLabel}, ${f.severityLabel.toLowerCase()} önem`).join('. ');
  return `${t}. Risk puanı yüz üzerinden ${report.score}. ${report.findings.length} madde bulundu. ${top}. Ayrıntılar ekranda. Hukuki tavsiye değildir.`;
}
