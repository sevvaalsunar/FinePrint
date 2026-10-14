// ≤ 90 sn demo videosu: (1) mutlu yol, (2) gizli talimat saldırısı, (3) sistemin dürüstçe "emin değilim" dediği an.
// Çalıştır:  npm run serve   (ayrı terminal)   +   npm run cy:run   → cypress/videos/demo.cy.js.mp4
import { fakeModel } from '../support/fakeModel.js';

const stub = scenario => cy.intercept('POST', '**/v1/chat/completions', req => {
  req.reply({ choices: [{ message: { content: JSON.stringify(fakeModel(scenario, req.body)) } }] });
});
const beat = ms => cy.wait(ms);   // videoda okunabilsin diye kısa duraklar

describe('İnce Yazı demo', () => {
  it('1) Mutlu yol: riskli maddeler, birebir alıntılarla', () => {
    stub('happy');
    cy.visit('/panel.html?fixture=happy');   // sayfa açılır açılmaz kendiliğinden tarar; düğmeye basmak gerekmez
    cy.get('#progress').should('contain', 'okunuyor'); beat(1200);
    cy.get('#verdict[data-verdict]', { timeout: 15000 }).should('be.visible').and('not.have.attr', 'data-verdict', 'uncertain');
    cy.get('#sound-caption').should('contain', 'Ses:');
    cy.get('#findings .finding').should('have.length.at.least', 4);
    cy.get('#findings .finding').each($f => cy.wrap($f).find('blockquote.quote').should('not.be.empty'));   // alıntısız madde yok
    cy.contains('.finding', 'Tahkim').should('contain', 'toplu dava'); beat(3500);
    cy.get('#findings').scrollIntoView(); beat(3500);
    cy.get('.legal').should('contain', 'Hukuki tavsiye değildir'); beat(2500);
  });

  it('2) Prompt injection: sayfadaki gizli talimat ve ele geçirilmiş model', () => {
    stub('compromised');
    cy.visit('/panel.html?fixture=injection'); beat(1000);
    cy.get('#verdict', { timeout: 15000 }).should('be.visible').and('not.have.attr', 'data-verdict', 'safe');
    cy.get('#findings .finding').should('have.length.at.least', 2);            // model "risk yok" dese de kurallar yakaladı
    cy.get('#injection-wrap').should('be.visible').find('summary').click();
    cy.get('#injection').should('contain', 'Gizli metin'); beat(4500);
  });

  it('3) Belirsizlik: uydurma alıntı elenir, sistem emin olamadığını söyler', () => {
    stub('uncertain');
    cy.visit('/panel.html?fixture=uncertain'); beat(1000);
    cy.get('#verdict', { timeout: 15000 }).should('have.attr', 'data-verdict', 'uncertain');
    cy.get('#verdict-title').should('contain', 'Emin olamadım');
    cy.get('#doubts li').should('have.length.at.least', 1);
    cy.get('#rejected-wrap').find('summary').click();
    cy.get('#rejected').should('contain', 'birebir bulunamadı'); beat(5000);
  });
});
