// Rotas públicas (compartilhado/rotas.mjs, as mesmas no servidor e no front) e a tela que cada uma abre (resolverTela).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caminho, caminhoCandidato, cargoPorSlug, lerCaminho, slugCargo, slugTexto, tituloPagina } from '../../compartilhado/rotas.mjs';
import { resolverTela } from '../../src/rota/resolver.ts';

const cargo = (eleicao, cd, turno, ufs) => ({ id: `${eleicao}-${cd}`, eleicao, cargo: cd, turno, ufs });
const CONFIG = {
  cargos: [
    cargo('6257', '1', 1, ['sp', 'df', 'zz']),
    cargo('6259', '3', 1, ['sp', 'df']),
    cargo('6259', '8', 1, ['df']),
    cargo('6258', '1', 2, ['sp', 'df', 'zz']),
  ],
};

test('slugTexto tira acentos e pontuação', () => {
  assert.equal(slugTexto("São Paulo d'Oeste"), 'sao-paulo-d-oeste');
  assert.equal(slugTexto('  JOÃO PESSOA  '), 'joao-pessoa');
});

test('caminho e lerCaminho são inversos', () => {
  const casos = [
    {},
    { cargo: 'governador' },
    { cargo: 'governador', uf: 'sp' },
    { cargo: 'governador', uf: 'sp', mun: '71072' },
    { cargo: 'governador', uf: 'sp', mun: '71072', zona: '0001' },
  ];
  for (const c of casos) assert.deepEqual(lerCaminho(caminho(c)), c);
  assert.equal(caminho({ cargo: 'governador', uf: 'sp', mun: '71072', munNome: 'SÃO PAULO', zona: '0001' }), '/governador/sp/71072-sao-paulo/zona-0001');
  assert.deepEqual(lerCaminho('/governador/sp/71072-sao-paulo/zona-0001/'), { cargo: 'governador', uf: 'sp', mun: '71072', zona: '0001' });
});

test('lerCaminho recusa formatos que não são rota', () => {
  for (const p of ['/governador/sao-paulo', '/governador/sp/abc', '/governador/sp/71072/zona-x', '/a/b/c/d/e', '/Governador', '/candidato/abc']) {
    assert.equal(lerCaminho(p), null, p);
  }
});

test('candidato', () => {
  assert.equal(caminhoCandidato('250002345678', 'Fulano de Tal'), '/candidato/250002345678-fulano-de-tal');
  assert.deepEqual(lerCaminho('/candidato/250002345678-fulano-de-tal'), { candidato: '250002345678' });
});

test('slug do cargo leva o turno', () => {
  assert.equal(slugCargo({ cargo: '1', turno: 1 }), 'presidente');
  assert.equal(slugCargo({ cargo: '1', turno: 2 }), 'presidente-2-turno');
  assert.equal(cargoPorSlug(CONFIG.cargos, 'presidente-2-turno')?.id, '6258-1');
});

test('tituloPagina', () => {
  assert.equal(tituloPagina({}), 'Apuração.org: resultados das Eleições 2026 ao vivo');
  assert.equal(tituloPagina({ cargoNome: 'Governador', uf: 'sp', ufNome: 'São Paulo' }), 'Governador São Paulo 2026: resultado da apuração');
  assert.equal(tituloPagina({ cargoNome: 'Presidente', uf: 'zz' }), 'Presidente no exterior 2026: resultado da apuração');
  assert.equal(tituloPagina({ cargoNome: 'Governador', uf: 'sp', munNome: 'São Paulo', zona: '0001' }), 'Governador em São Paulo (SP), zona 1: resultado 2026');
});

test('resolverTela: cargo pelo slug ou pelo id antigo, senão o primeiro', () => {
  assert.equal(resolverTela(CONFIG, {}).cargo.id, '6257-1');
  assert.equal(resolverTela(CONFIG, { cargo: 'governador' }).cargo.id, '6259-3');
  assert.equal(resolverTela(CONFIG, { cargo: '6259-3' }).cargo.id, '6259-3');
  assert.equal(resolverTela(CONFIG, { cargo: 'inexistente' }).cargo.id, '6257-1');
});

test('resolverTela: UF fora do cargo volta ao Brasil; zona só com município', () => {
  assert.deepEqual(resolverTela(CONFIG, { cargo: 'deputado-distrital', uf: 'sp' }).local, {});
  assert.deepEqual(resolverTela(CONFIG, { cargo: 'governador', uf: 'sp', zona: '0001' }).local, { uf: 'sp', mun: undefined, zona: undefined });
  assert.deepEqual(resolverTela(CONFIG, { cargo: 'governador', uf: 'sp', mun: '71072', zona: '0001' }).local, { uf: 'sp', mun: '71072', zona: '0001' });
});
