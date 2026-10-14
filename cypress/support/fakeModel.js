// Cypress için "sahte LLM". Gerçek bir modelin üç davranışını taklit eder; böylece demo deterministik olur,
// ama doğrulama, skor ve arayüz hattı GERÇEK koddur.
import { ruleScan } from '../../src/rules.js';

export function parseSegments(body) {
  const user = body.messages.find(m => m.role === 'user').content;
  return [...user.matchAll(/^\[#(\d+)\] (.*)$/gm)].map(m => ({ id: Number(m[1]), text: m[2] }));
}

export function fakeModel(scenario, body) {
  const segs = parseSegments(body);
  if (scenario === 'happy') {
    const findings = ruleScan(segs).map(f => ({ ...f, confidence: 0.86 }));
    const ad = segs.find(s => /reklam sağlayıcılarla paylaşılabilir/.test(s.text));
    if (ad) findings.push({ segment_id: ad.id, category: 'data_sale_sharing', severity: 2, confidence: 0.82,
      quote: 'Kullanım verileriniz, reklam ve analiz amacıyla iş ortaklarımız ve üçüncü taraf reklam sağlayıcılarla paylaşılabilir.',
      explanation_tr: 'Ne yaptığınızı gösteren kullanım verileriniz, reklam veren şirketlerle paylaşılabilir.' });
    return { document_type: 'mixed', findings };
  }
  if (scenario === 'compromised') return { document_type: 'terms_of_service', findings: [] };   // enjeksiyona uymuş model
  if (scenario === 'uncertain') {
    const s = segs.find(x => /share some information/.test(x.text)) || segs[0];
    return { document_type: 'mixed', findings: [
      { segment_id: s.id, category: 'data_sale_sharing', severity: 3, confidence: 0.95,
        quote: 'We sell all of your browsing history to data brokers every single week.',          // uydurma: belgede yok
        explanation_tr: 'Tarama geçmişiniz her hafta veri simsarlarına satılıyor.' },
      { segment_id: s.id, category: 'data_sale_sharing', severity: 2, confidence: 0.4,
        quote: 'We may share some information with partners to improve things.',
        explanation_tr: 'Bazı bilgiler ortaklarla paylaşılabilir, ama neyin paylaşıldığı belirsiz.' }] };
  }
  if (scenario === 'clean') return { document_type: 'terms_of_service', findings: [] };
  throw new Error('bilinmeyen senaryo ' + scenario);
}
