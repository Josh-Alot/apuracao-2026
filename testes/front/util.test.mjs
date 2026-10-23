import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coresDuelo, corPartido, fmt, fmtDecimal, fmtDecimal1, fmtDiferenca1, fmtPct, siglaUf, titulo } from '../../src/lib/util.ts';

test('titulo: maiúsculas do TSE viram nome próprio', () => {
  assert.equal(titulo('SÃO JOSÉ DOS CAMPOS'), 'São José dos Campos');
  assert.equal(titulo('RIO DE JANEIRO'), 'Rio de Janeiro');
});

test('formatação pt-BR', () => {
  assert.equal(fmt(1234567), '1.234.567');
  assert.equal(fmtPct(50.5), '50,50%');
  assert.equal(fmtDecimal(3.456), '3,46');
  assert.equal(fmtDecimal1(48.25), '48,3');
  assert.equal(fmtDiferenca1(35.84), '+35,8');
  assert.equal(fmtDiferenca1(-4.1), '−4,1');
});

test('siglaUf: exterior vira EXT', () => {
  assert.equal(siglaUf('sp'), 'SP');
  assert.equal(siglaUf('zz'), 'EXT');
});

test('coresDuelo: cores parecidas trocam a do segundo', () => {
  const [a, b] = coresDuelo('PT', 'PT');
  assert.equal(a, corPartido('PT'));
  assert.notEqual(b, a);
  assert.deepEqual(coresDuelo('PT', 'PL'), [corPartido('PT'), corPartido('PL')]);
});
