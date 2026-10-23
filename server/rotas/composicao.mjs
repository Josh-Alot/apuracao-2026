// GET /api/composicao: cadeiras por partido numa casa legislativa (Senado, Câmara, assembleias).

import { getResultado, getResultadosRapidos, PRIORIDADE } from '../tse.mjs';
import { HttpError, cargoDe, validarUf } from '../http.mjs';
/** @import { Composicao, Eleito, Flags } from '../../compartilhado/api.mjs' */

/**
 * Eleitos de um resultado de UF (Senado ou proporcional). Com a situação oficial do TSE (`st`)
 * usa os eleitos oficiais; antes dela, projeta: no proporcional pelas vagas de cada chapa
 * (`chapa`, calculado em `tse.mjs`), no Senado pelos `vagas` mais votados.
 */
function eleitosDe(r) {
  const oficiais = r.candidatos.filter((c) => c.status === 'eleito');
  if (oficiais.length || r.candidatos.some((c) => c.status === 'suplente' || c.status === 'nao-eleito')) {
    return { eleitos: oficiais, projecao: false };
  }
  const validos = r.candidatos.filter((c) => c.votos > 0 && c.destinoVotos === 'Válido');
  const eleitos = r.cargo.cd === '5'
    ? validos.slice(0, r.cargo.vagas) // candidatos já vêm por votos
    : validos.filter((c) => c.chapa && c.chapa.suplente == null);
  return { eleitos, projecao: eleitos.length > 0 };
}

/**
 * Cadeiras por partido. Senado: sempre o Brasil (as cadeiras em disputa na eleição); Dep. Federal:
 * a bancada da UF ou, no Brasil, a Câmara inteira; Dep. Estadual/Distrital: a assembleia da UF.
 *
 * @param {URLSearchParams} q
 * @param {Flags} flags
 * @returns {Promise<Composicao>}
 */
export async function composicao(q, flags) {
  if (!flags.hemiciclo) throw new HttpError(404, 'composição das casas desligada');
  const c = await cargoDe(q.get('cargo'), flags);
  if (c.cargo !== '5' && c.tipo !== 'proporcional') throw new HttpError(400, 'cargo sem casa legislativa');
  const pedida = validarUf(q.get('uf') || 'br');
  const nacional = c.cargo === '5' || pedida === 'br';
  if (nacional && c.cargo !== '5' && c.cargo !== '6') throw new HttpError(400, 'escolha uma UF');
  const ufs = (nacional ? c.ufs : [pedida]).filter((x) => x !== 'zz');
  const base = { eleicao: c.eleicao, cargo: c.cargo };
  // Uma UF: o mesmo arquivo do painel (já em cache). Brasil: os mesmos 27 arquivos do mapa nacional.
  const rs = nacional
    ? await getResultadosRapidos(ufs.map((x) => ({ ...base, uf: x })), 30_000, PRIORIDADE.media)
    : [await getResultado({ ...base, uf: ufs[0] })];

  const cadeiras = new Map();
  /** @type {Eleito[]} */
  const eleitos = [];
  let vagas = 0;
  let atribuidas = 0;
  let projecao = false;
  let somaPct = 0;
  let faltando = 0;
  for (const r of rs) {
    if (!r) { faltando++; continue; }
    vagas += r.cargo.vagas;
    somaPct += r.secoes.pct;
    const e = eleitosDe(r);
    projecao ||= e.projecao;
    const colocacao = new Map(r.candidatos.map((cand, i) => [cand.sq, i + 1]));
    for (const cand of e.eleitos) {
      cadeiras.set(cand.partido, (cadeiras.get(cand.partido) ?? 0) + 1);
      atribuidas++;
      eleitos.push({
        sq: cand.sq, numero: cand.numero, nome: cand.nomeUrna, partido: cand.partido, uf: r.abrangencia.cd,
        votos: cand.votos, pct: cand.pct, colocacao: colocacao.get(cand.sq), detalhe: cand.detalhe, foto: cand.foto,
      });
    }
  }
  const partidos = [...cadeiras].map(([sigla, n]) => ({ sigla, cadeiras: n }))
    .sort((a, b) => b.cadeiras - a.cadeiras || a.sigla.localeCompare(b.sigla, 'pt-BR'));
  // Cadeiras na ordem do plenário: partidos como acima e, dentro do partido, pela colocação na eleição
  // (votos; no Brasil, a votação nominal de cada um no seu estado).
  const ordemPartido = new Map(partidos.map((p, i) => [p.sigla, i]));
  eleitos.sort((a, b) => ordemPartido.get(a.partido) - ordemPartido.get(b.partido) || b.votos - a.votos
    || a.colocacao - b.colocacao);
  const lidos = rs.length - faltando;
  return {
    abrangencia: nacional ? 'br' : pedida,
    vagas,
    atribuidas,
    projecao,
    pctApurado: lidos ? Math.round((100 * somaPct) / lidos) / 100 : 0,
    // UFs cujo resultado ainda não chegou do TSE (as vagas delas ainda não entram na conta).
    faltando,
    partidos,
    eleitos,
  };
}
