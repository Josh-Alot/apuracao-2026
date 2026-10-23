// Resultados reais do 1º turno (arquivo/ele2026-1turno, já final) passados pelo normalizar(): o snapshot congela
// votos, situação, "matematicamente" e chapas (suplência/puxador). Mudou o normalizar de propósito? Rode
// `npm run test:atualizar` e confira o diff do .snapshot antes do commit.

import { test } from 'node:test';
import { doArquivo } from '../../server/arquivo.mjs';
import { normalizar } from '../../server/tse/apuracao.mjs';
import { TSE_BASE, resultadoUrl } from '../../server/tse/urls.mjs';

const CASOS = [
  { eleicao: '6257', cargo: '1', uf: 'br' }, // Presidente, arquivo da disputa (2º turno)
  { eleicao: '6257', cargo: '1', uf: 'ac' }, // Presidente na UF: sem cálculo próprio
  { eleicao: '6259', cargo: '3', uf: 'ac' }, // Governador com 2º turno
  { eleicao: '6259', cargo: '3', uf: 'sp' },
  { eleicao: '6259', cargo: '5', uf: 'ac' }, // Senador
  { eleicao: '6259', cargo: '6', uf: 'rr' }, // Dep. Federal
  { eleicao: '6259', cargo: '7', uf: 'rr' }, // Dep. Estadual
  { eleicao: '6259', cargo: '8', uf: 'df' }, // Dep. Distrital
  { eleicao: '6259', cargo: '3', uf: 'ac', mun: '01392' }, // município
  { eleicao: '6259', cargo: '3', uf: 'ac', mun: '01392', zona: '0009' }, // zona
];

const nomeCaso = ({ eleicao, cargo, uf, mun, zona }) => [eleicao, `c${cargo}`, uf, mun, zona && `z${zona}`].filter(Boolean).join(' ');

/** O que importa do resultado normalizado (sem fotos e vices, que são só URLs). */
function essencial(r) {
  const { candidatos, ...resto } = r;
  return {
    ...resto,
    candidatos: candidatos.map((c) => ({
      sq: c.sq, numero: c.numero, nomeUrna: c.nomeUrna, partido: c.partido, coligacao: c.coligacao,
      votos: c.votos, pct: c.pct, status: c.status, detalhe: c.detalhe, destinoVotos: c.destinoVotos,
      matematicamente: c.matematicamente, chapa: c.chapa,
    })),
  };
}

const lerRaw = (params) => doArquivo(resultadoUrl(params), TSE_BASE);

for (const params of CASOS) {
  test(`normalizar: ${nomeCaso(params)}`, async (t) => {
    t.assert.snapshot(essencial(normalizar(await lerRaw(params), params)));
  });
}

/**
 * Apuração em andamento simulada sobre um resultado real: sem `st` do TSE e com eleitores faltando. Exercita o que
 * o resultado final não cobre: a projeção das chapas pelas vagas (`agr.vag`) e o cálculo de "matematicamente".
 */
function emAndamento(raw, fracaoFaltando) {
  const r = structuredClone(raw);
  for (const agr of r.carg[0].agr) for (const par of agr.par) for (const c of par.cand) { c.st = ''; c.e = 'n'; }
  r.e = { ...r.e, esnt: String(Math.round(Number(r.e.te) * fracaoFaltando)) };
  r.tf = 'n';
  return r;
}

for (const [params, fracao] of [
  [{ eleicao: '6257', cargo: '1', uf: 'br' }, 0.01],
  [{ eleicao: '6259', cargo: '3', uf: 'sp' }, 0.05],
  [{ eleicao: '6259', cargo: '5', uf: 'ac' }, 0.02],
  [{ eleicao: '6259', cargo: '6', uf: 'rr' }, 0.03],
]) {
  test(`normalizar em andamento (${fracao * 100}% faltando): ${nomeCaso(params)}`, async (t) => {
    t.assert.snapshot(essencial(normalizar(emAndamento(await lerRaw(params), fracao), params)));
  });
}
