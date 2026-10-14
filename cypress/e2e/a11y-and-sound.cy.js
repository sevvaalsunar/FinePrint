import { fakeModel } from '../support/fakeModel.js';
describe('Erişilebilirlik ve ses', () => {
  beforeEach(() => cy.intercept('POST', '**/v1/chat/completions', req => req.reply({ choices: [{ message: { content: JSON.stringify(fakeModel('clean', req.body)) } }] })));
  it('temiz metinde onay sesi imzası, canlı bölgede nedenli duyuru', () => {
    cy.visit('/panel.html?fixture=clean', { onBeforeLoad(win) {
      win.__earcons = []; const Orig = win.AudioContext;
      win.AudioContext = function () { const c = new Orig(); const o = c.createOscillator.bind(c); c.createOscillator = () => { const x = o(); win.__earcons.push(1); return x; }; return c; };
    } });
    cy.get('#verdict').should('have.attr', 'data-verdict', 'safe');
    cy.get('#live').should('contain', 'Belirgin risk bulunmadı');
    cy.window().its('__earcons.length').should('eq', 2);               // safe = 2 nota (otomatik çalar, tıklama yok)
    cy.get('main, header, footer').should('have.length.at.least', 3);   // landmark'lar
    cy.get('#btn-sound').should('have.attr', 'aria-pressed', 'true').click().should('have.attr', 'aria-pressed', 'false');   // tek ses anahtarı
    cy.get('#track').should('have.attr', 'role', 'img').and('have.attr', 'aria-label').and('contain', 'yüz üzerinden');
  });
});
