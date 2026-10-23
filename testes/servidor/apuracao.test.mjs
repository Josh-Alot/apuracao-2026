// Regras de "matematicamente eleito" / "2º turno garantido", QE e situação, com resultados montados à mão.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificar, normalizar, quocienteEleitoral } from '../../server/tse.mjs';

/** JSON mínimo no formato do TSE: `votos` = { sigla: votos }, todos válidos, um partido isolado por candidato. */
function raw({ cargo = '1', tpabr = 'br', turno = '1', votos, faltam = 0, subJudice = 0, vagas = 1 }) {
  const vv = Object.values(votos).reduce((a, b) => a + b, 0);
  return {
    tpabr, cdabr: tpabr, t: turno,
    e: { te: String(vv + faltam), esnt: String(faltam) },
    v: { vv: String(vv), vansj: String(subJudice) },
    s: {},
    carg: [{
      cd: cargo, nv: String(vagas),
      agr: Object.entries(votos).map(([sg, vap], i) => ({
        tp: 'p',
        par: [{ sg, tvtn: String(vap), tvtl: '0', cand: [{ n: String(10 + i), sqcand: sg, nm: sg, nmu: sg, vap: String(vap), st: '', e: 'n', dvt: 'Válido' }] }],
      })),
    }],
  };
}

const situacao = (r) => Object.fromEntries(
  normalizar(r, { eleicao: '1', uf: r.tpabr }).candidatos.map((c) => [c.sq, c.matematicamente]),
);

test('executivo: maioria absoluta mesmo com todos os votos que faltam contra', () => {
  assert.deepEqual(situacao(raw({ votos: { A: 600, B: 300, C: 100 }, faltam: 100 })), { A: 'eleito', B: null, C: null });
});

test('executivo: sem maioria garantida, ninguém é marcado', () => {
  assert.deepEqual(situacao(raw({ votos: { A: 600, B: 300, C: 100 }, faltam: 300 })), { A: null, B: null, C: null });
});

test('executivo: voto sub judice conta como válido para os rivais', () => {
  assert.deepEqual(situacao(raw({ votos: { A: 600, B: 300, C: 100 }, faltam: 100, subJudice: 101 })), { A: null, B: null, C: null });
});

test('executivo: 2º turno garantido quando ninguém alcança a maioria e os rivais não alcançam os dois primeiros', () => {
  assert.deepEqual(situacao(raw({ votos: { A: 450, B: 400, C: 150 }, faltam: 50 })), { A: 'segundo-turno', B: 'segundo-turno', C: null });
});

test('executivo: no 2º turno só a maioria absoluta conta', () => {
  assert.deepEqual(situacao(raw({ turno: '2', votos: { A: 450, B: 400, C: 150 }, faltam: 50 })), { A: null, B: null, C: null });
});

test('executivo: fora do arquivo da disputa nada é calculado', () => {
  assert.deepEqual(situacao(raw({ tpabr: 'uf', votos: { A: 900, B: 100 } })), { A: null, B: null });
});

test('senado: empate com o que falta conta como ameaça', () => {
  const r = (faltam) => raw({ cargo: '5', tpabr: 'uf', votos: { A: 500, B: 400 }, faltam });
  assert.equal(situacao(r(99)).A, 'eleito');
  assert.equal(situacao(r(100)).A, null);
});

test('senado: com duas vagas, basta ter no máximo uma ameaça', () => {
  const r = raw({ cargo: '5', tpabr: 'uf', vagas: 2, votos: { A: 500, B: 400, C: 100 }, faltam: 250 });
  assert.deepEqual(situacao(r), { A: 'eleito', B: 'eleito', C: null });
});

test('quociente eleitoral: fração até meio é desprezada, acima de meio arredonda para cima', () => {
  assert.equal(quocienteEleitoral(1000, 3), 333);
  assert.equal(quocienteEleitoral(1001, 2), 500); // 500,5: meio exato é desprezado
  assert.equal(quocienteEleitoral(1007, 4), 252); // 251,75
  assert.equal(quocienteEleitoral(1005, 4), 251); // 251,25
});

test('classificar: textos do TSE', () => {
  assert.deepEqual(classificar('Eleito', 's'), { status: 'eleito', detalhe: null });
  assert.deepEqual(classificar('Eleito por QP', 's'), { status: 'eleito', detalhe: 'por QP' });
  assert.deepEqual(classificar('Eleito por média', 's'), { status: 'eleito', detalhe: 'por média' });
  assert.deepEqual(classificar('2º turno', 's'), { status: 'segundo-turno', detalhe: null });
  assert.deepEqual(classificar('Não eleito', 'n'), { status: 'nao-eleito', detalhe: null });
  assert.deepEqual(classificar('Suplente', 'n'), { status: 'suplente', detalhe: null });
  assert.deepEqual(classificar('', 's'), { status: 'eleito', detalhe: null });
  assert.deepEqual(classificar('', 'n'), { status: null, detalhe: null });
  assert.deepEqual(classificar('Renúncia', 'n'), { status: 'outro', detalhe: 'Renúncia' });
});
