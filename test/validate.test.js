import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, computeScore, levelOf, norm } from '../src/schema.js';
import { segmentText } from '../src/segment.js';
import { analyze } from '../src/pipeline.js';

const TEXT = `Kullanım Koşulları\nYou agree that any dispute will be resolved by binding arbitration, and you waive your right to participate in a class action.\nWe may share your personal information with third party advertising partners.\nThis is a harmless sentence about our office hours which is not a risk at all.`;
const { segments } = segmentText(TEXT);
const idOf = frag => segments.find(s => s.text.includes(frag)).id;

test('birebir alıntı kabul edilir', () => {
  const v = validate({ document_type: 'terms_of_service', findings: [{
    segment_id: idOf('arbitration'), category: 'arbitration_waiver', severity: 3,
    quote: 'resolved by binding arbitration, and you waive your right', explanation_tr: 'Mahkemeye gidemezsiniz.', confidence: 0.9 }] }, segments);
  assert.equal(v.accepted.length, 1); assert.equal(v.rejected.length, 0);
});

test('uydurma alıntı reddedilir (alıntısı olmayan iddia geçersiz)', () => {
  const v = validate({ document_type: 'terms_of_service', findings: [{
    segment_id: idOf('arbitration'), category: 'arbitration_waiver', severity: 3,
    quote: 'we will charge you ten thousand dollars if you leave', explanation_tr: 'Uydurma.', confidence: 0.99 }] }, segments);
  assert.equal(v.accepted.length, 0); assert.equal(v.rejected.length, 1);
});

test('alıntı başka segmentten ise reddedilir', () => {
  const v = validate({ document_type: 'mixed', findings: [{
    segment_id: idOf('office hours'), category: 'arbitration_waiver', severity: 3,
    quote: 'resolved by binding arbitration, and you waive your right', explanation_tr: 'Yanlış segment.', confidence: 0.9 }] }, segments);
  assert.equal(v.accepted.length, 0);
});

test('şema ihlalleri: bilinmeyen kategori, önem 9, çok kısa alıntı, güven 2', () => {
  const base = { segment_id: idOf('share your'), quote: 'share your personal information with third party', explanation_tr: 'Açıklama metni burada.', confidence: 0.8, severity: 2, category: 'data_sale_sharing' };
  const v = validate({ document_type: 'mixed', findings: [
    { ...base, category: 'world_domination' }, { ...base, severity: 9 }, { ...base, quote: 'share your' }, { ...base, confidence: 2 }] }, segments);
  assert.equal(v.accepted.length, 0); assert.equal(v.rejected.length, 4);
});

test('düşük güven ve kategori-ipucu uyumsuzluğu "emin değilim" kovasına gider, skora girmez', () => {
  const q = 'share your personal information with third party advertising partners';
  const v = validate({ document_type: 'mixed', findings: [
    { segment_id: idOf('share your'), category: 'data_sale_sharing', severity: 2, quote: q, explanation_tr: 'Düşük güven örneği.', confidence: 0.3 },
    { segment_id: idOf('share your'), category: 'jurisdiction', severity: 1, quote: q, explanation_tr: 'Kategori uyuşmuyor.', confidence: 0.9 }] }, segments);
  assert.equal(v.accepted.length, 0); assert.equal(v.uncertain.length, 2);
});

test('tipografik tırnak / boşluk farkı alıntıyı bozmaz', () => {
  assert.equal(norm('We  “may”\nshare'), norm('we "may" share'));
});

test('skor kodda hesaplanır ve tekrarlayan kategori sınırlıdır', () => {
  const f = c => ({ category: c, severity: 3 });
  assert.equal(computeScore([]), 0);
  assert.ok(computeScore([f('arbitration_waiver'), f('arbitration_waiver'), f('arbitration_waiver')]) <= computeScore([f('arbitration_waiver'), f('data_sale_sharing'), f('auto_renewal')]));
  assert.equal(levelOf(10), 'low'); assert.equal(levelOf(40), 'medium'); assert.equal(levelOf(80), 'high');
});

test('bozuk JSON atılır (hata fırlatır), pipeline bunu "okunamadı" olarak sayar', async () => {
  const extracted = { text: TEXT.repeat(6), charCount: TEXT.length * 6, hiddenChars: 0, hiddenSamples: [], url: 'x', title: 't' };
  const r = await analyze(extracted, { settings: { model: 'm' }, transport: async () => 'bu json değil' });
  assert.ok(r.stats.failedBatches >= 1);
  assert.notEqual(r.verdict, 'safe');
  assert.ok(r.doubts.some(d => d.includes('okunamadı')));
});
