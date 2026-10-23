// Regras de tela do front (src/dominio): cargo/turno, fase da votação, placar e títulos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargoBase, destinoTurno, localCargo, nomeCargo, semSegundoTurno, turnosDe } from '../../src/dominio/cargo.ts';
import { faseVotacao, rotuloEstado, situacaoApuracao } from '../../src/dominio/fase.ts';
import { coresFinalistas, corDoLider, finalistas } from '../../src/dominio/duelo.ts';
import { placarDe, regioesVencidas, rotuloRegioesVencidas } from '../../src/dominio/placar.ts';
import { nomeDaRegiao, tituloDaAba } from '../../src/dominio/titulo.ts';
import { textoSituacao } from '../../src/dominio/situacao.ts';
import { corPartido } from '../../src/lib/util.ts';

const cargo = (eleicao, cd, turno, ufs, extra = {}) => ({
  id: `${eleicao}-${cd}`, eleicao, cargo: cd, turno, ufs,
  nome: { 1: 'Presidente', 3: 'Governador', 6: 'Deputado Federal' }[cd] + (turno === 2 ? ' (2º turno)' : ''),
  tipo: cd === '6' ? 'proporcional' : 'majoritario', escopo: cd === '1' ? 'br' : 'uf',
  abertura: '2026-10-25T08:00:00-03:00', encerramento: '2026-10-25T17:00:00-03:00', ...extra,
});
const PRES1 = cargo('6257', '1', 1, ['sp', 'zz']);
const GOV1 = cargo('6259', '3', 1, ['sp', 'rj']);
const DEP1 = cargo('6259', '6', 1, ['sp', 'rj']);
const PRES2 = cargo('6258', '1', 2, ['sp', 'zz']);
const GOV2 = cargo('6260', '3', 2, ['rj']);
const CONFIG = { cargos: [PRES1, GOV1, DEP1, PRES2, GOV2] };

const cand = (numero, partido, votos) => ({ numero, sq: `sq${numero}`, nomeUrna: `CAND ${numero}`, partido, votos });
const resultado = (...candidatos) => ({ secoes: { pct: 10 }, candidatos });

test('nomes do cargo', () => {
  assert.equal(cargoBase(GOV2), 'Governador');
  assert.equal(nomeCargo(GOV2), 'Governador 2º turno');
  assert.equal(nomeCargo(GOV1), 'Governador');
  assert.deepEqual(turnosDe(CONFIG), [1, 2]);
});

test('troca de cargo e de turno mantém a UF quando existe', () => {
  assert.deepEqual(localCargo(GOV1, 'rj'), { uf: 'rj' });
  assert.deepEqual(localCargo(PRES1, 'rj'), {});
  assert.deepEqual(destinoTurno(CONFIG, GOV1, 'rj', 2), [{ uf: 'rj' }, '6260-3']);
  assert.deepEqual(destinoTurno(CONFIG, GOV1, 'sp', 2), [{}, '6260-3']); // SP sem 2º turno para governador
  assert.deepEqual(destinoTurno(CONFIG, DEP1, 'sp', 2), [{ uf: 'sp' }, '6258-1']); // sem deputado no 2º turno: o 1º cargo
});

test('UF sem 2º turno para o cargo', () => {
  const gov2 = { ...GOV2, primeiroTurno: '6259-3' };
  assert.equal(semSegundoTurno(gov2, 'sp'), true);
  assert.equal(semSegundoTurno(gov2, 'rj'), false);
  assert.equal(semSegundoTurno(gov2, undefined), false);
  assert.equal(semSegundoTurno(gov2, 'zz'), false);
  assert.equal(semSegundoTurno(GOV1, 'ba'), false); // 1º turno: nunca
  assert.equal(semSegundoTurno({ ...PRES2, primeiroTurno: '6257-1' }, 'sp'), false);
});

test('fase da votação pelo relógio e pelo que chegou', () => {
  const t = (h) => Date.parse(`2026-10-25T${h}:00-03:00`);
  assert.equal(faseVotacao(PRES2, t('07:00'), null), 'antes');
  assert.equal(faseVotacao(PRES2, t('12:00'), null), 'votando');
  assert.equal(faseVotacao(PRES2, t('17:01'), 0), 'aguardando');
  assert.equal(faseVotacao(PRES2, t('17:01'), null, false, true), 'carregando');
  assert.equal(faseVotacao(PRES2, t('17:01'), null, true), 'indisponivel');
  assert.equal(faseVotacao(PRES2, t('17:30'), 0.5), 'apurando');
  assert.equal(faseVotacao({ ...PRES2, abertura: null, encerramento: null }, t('07:00'), null), 'apurando');
});

test('situação da apuração: % do resultado, senão o maior do mapa; erro sem dado = TSE indisponível', () => {
  const nada = { data: null, erro: null };
  assert.deepEqual(situacaoApuracao(nada, nada), { regioesTotal: 0, regioesComDado: 0, pctApurado: null, tseIndisponivel: false, carregando: true });
  assert.equal(situacaoApuracao({ data: resultado(), erro: null }, nada).pctApurado, 10);
  const mapa = { data: { sp: { pctApurado: 30 }, rj: null, mg: { pctApurado: 12 } }, erro: null };
  assert.deepEqual(situacaoApuracao(nada, mapa), { regioesTotal: 3, regioesComDado: 2, pctApurado: 30, tseIndisponivel: false, carregando: false });
  assert.equal(situacaoApuracao({ data: null, erro: 'HTTP 429' }, nada).tseIndisponivel, true);
  assert.equal(situacaoApuracao(nada, { data: { sp: null }, erro: null }).tseIndisponivel, true);
});

test('rótulo da faixa de status', () => {
  assert.equal(rotuloEstado('votando', { encerrada: false, aoVivo: true }), 'Votação em andamento');
  assert.equal(rotuloEstado('apurando', { encerrada: true, aoVivo: true }), 'Apuração encerrada');
  assert.equal(rotuloEstado('apurando', { encerrada: false, aoVivo: true }), 'Ao vivo');
  assert.equal(rotuloEstado('apurando', { encerrada: false, aoVivo: false }), 'Atualização periódica');
});

test('2º turno: finalistas pelo número de urna e cores do duelo', () => {
  const r = resultado(cand('22', 'PL', 60), cand('13', 'PT', 40));
  const par = finalistas(r);
  assert.deepEqual(par.map((c) => c.numero), ['13', '22']);
  assert.equal(finalistas(resultado(cand('13', 'PT', 1))), null);
  const cores = coresFinalistas(par);
  assert.equal(cores.get('13'), corPartido('PT'));
  assert.equal(corDoLider(cores)({ numero: '99', partido: 'NOVO' }), corPartido('NOVO'));
});

test('placar: os dois primeiros no 1º turno, os finalistas no 2º, nada nos proporcionais', () => {
  const r = resultado(cand('22', 'PL', 60), cand('13', 'PT', 40), cand('30', 'NOVO', 1));
  assert.deepEqual(placarDe(PRES1, r, null, null).par.map((c) => c.numero), ['22', '13']);
  assert.deepEqual(placarDe(PRES1, r, null, null).cores, [corPartido('PL'), corPartido('PT')]);
  assert.equal(placarDe(DEP1, r, null, null), null);
  assert.equal(placarDe(PRES1, resultado(cand('13', 'PT', 1)), null, null), null);
  const r2 = resultado(cand('22', 'PL', 60), cand('13', 'PT', 40));
  const par = finalistas(r2);
  const p = placarDe(PRES2, r2, par, coresFinalistas(par));
  assert.deepEqual(p.par.map((c) => c.numero), ['13', '22']);
  assert.deepEqual(p.cores, [corPartido('PT'), corPartido('PL')]);
});

test('regiões vencidas', () => {
  const dados = { sp: { lider: { numero: '13' } }, rj: { lider: { numero: '22' } }, mg: { lider: { numero: '13' } }, ba: null };
  assert.equal(regioesVencidas(dados, '13'), 2);
  assert.equal(regioesVencidas(null, '13'), 0);
  assert.equal(rotuloRegioesVencidas({}), 'UFs');
  assert.equal(rotuloRegioesVencidas({ uf: 'zz' }), 'cidades');
  assert.equal(rotuloRegioesVencidas({ uf: 'sp', mun: '71072' }), 'zonas');
  assert.equal(rotuloRegioesVencidas({ uf: 'sp', mun: '71072', zona: '0001' }), null);
});

test('títulos', () => {
  const mun = { cd: '71072', nome: 'SÃO PAULO', zonas: ['0001', '0002'] };
  assert.equal(nomeDaRegiao({}, undefined), 'Brasil');
  assert.equal(nomeDaRegiao({ uf: 'sp' }, undefined), 'São Paulo');
  assert.equal(nomeDaRegiao({ uf: 'sp', mun: '71072' }, mun), 'São Paulo (SP)');
  assert.equal(nomeDaRegiao({ uf: 'sp', mun: '71072', zona: '0002' }, mun), 'Zona 2 · São Paulo');
  const base = { cargo: GOV2, telaTemCargo: true, local: { uf: 'rj' }, munAtual: undefined, ficha: undefined, candidato: undefined };
  assert.equal(tituloDaAba(base), 'Governador 2º turno Rio de Janeiro 2026: resultado da apuração');
  assert.equal(tituloDaAba({ ...base, telaTemCargo: false }), 'Apuração.org: resultados das Eleições 2026 ao vivo');
  assert.equal(tituloDaAba({ ...base, ficha: 'sq13' }), null);
  assert.equal(tituloDaAba({ ...base, ficha: 'sq13', candidato: cand('13', 'PT', 1) }), 'Cand 13 (PT): votos, perfil e bens em 2026');
});

test('texto da situação do candidato', () => {
  const c = (extra) => ({ ...cand('13', 'PT', 100), status: null, detalhe: null, matematicamente: null, ...extra });
  assert.equal(textoSituacao(c({})), null);
  assert.equal(textoSituacao(c({ status: 'eleito', detalhe: 'por QP' })), 'Eleito');
  assert.equal(textoSituacao(c({ status: 'eleito', detalhe: 'por QP' }), { detalhe: true }), 'Eleito por QP');
  assert.equal(textoSituacao(c({ status: 'eleito' }), { detalhe: true }), 'Eleito');
  assert.equal(textoSituacao(c({ status: 'segundo-turno' })), 'Vai ao 2º turno');
  // A situação oficial vem antes do "matematicamente".
  assert.equal(textoSituacao(c({ status: 'segundo-turno', matematicamente: 'eleito' })), 'Vai ao 2º turno');
  assert.equal(textoSituacao(c({ matematicamente: 'eleito' })), 'Matematicamente eleito');
  assert.equal(textoSituacao(c({ matematicamente: 'segundo-turno' })), '2º turno garantido');
});
