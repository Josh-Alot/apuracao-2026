// GET /api/busca: candidatos por nome, número ou partido, num índice em memória montado dos resultados.

import { getConfig, getResultadosRapidos, PRIORIDADE } from '../tse.mjs';
import { cargoVisivel } from '../flags.mjs';
import { HttpError, cargoDe, validarUf } from '../http.mjs';
/** @import { Flags, RespostaBusca } from '../../compartilhado/api.mjs' */

const indices = new Map(); // chave -> { ts, ttl, promise }
const INDICE_TTL = 30_000;
// Índice montado antes de todas as listas chegarem do TSE (estão na fila): vale pouco, para a
// próxima busca já incluir o que chegou.
const INDICE_PARCIAL_TTL = 4_000;

async function indiceBusca(cargoId, ufFiltro, flags) {
  const chave = `${cargoId || '*'}|${ufFiltro || '*'}|${flags.segundoTurno ? 2 : 1}`;
  const hit = indices.get(chave);
  if (hit && Date.now() - hit.ts < hit.ttl) return hit.promise;

  const promise = (async () => {
    const cfg = await getConfig();
    const cargos = cfg.cargos.filter((c) => (!cargoId || c.id === cargoId) && cargoVisivel(c, flags));
    const alvos = [];
    for (const c of cargos) {
      if (c.escopo === 'br') alvos.push({ c, uf: ufFiltro || 'br' });
      else for (const u of c.ufs) if (!ufFiltro || u === ufFiltro) alvos.push({ c, uf: u });
    }
    // A busca não precisa de votos ao segundo: usa o que estiver em cache e renova devagar.
    const rs = await getResultadosRapidos(
      alvos.map(({ c, uf: u }) => ({ eleicao: c.eleicao, cargo: c.cargo, uf: u })), 2 * 60_000, PRIORIDADE.baixa,
    );
    const out = [];
    const faltando = rs.filter((r) => r === undefined).length;
    alvos.forEach(({ c, uf: u }, i) => {
      const r = rs[i];
      if (!r) return;
      for (const cand of r.candidatos) {
        out.push({
          ...cand,
          vices: undefined,
          cargoId: c.id,
          cargoNome: c.nome,
          uf: u,
          pctApurado: r.secoes.pct,
          chave: normalizarTexto(`${cand.nomeUrna} ${cand.nome} ${cand.partido}`),
        });
      }
    });
    const indice = { itens: out, listas: alvos.length, faltando };
    if (faltando) {
      const e = indices.get(chave);
      if (e?.promise === promise) e.ttl = INDICE_PARCIAL_TTL;
    }
    return indice;
  })();
  promise.catch(() => indices.delete(chave));
  indices.set(chave, { ts: Date.now(), ttl: INDICE_TTL, promise });
  return promise;
}

const normalizarTexto = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * @param {URLSearchParams} q
 * @param {Flags} flags
 * @returns {Promise<RespostaBusca>}
 */
export async function busca(q, flags) {
  if (!flags.busca) throw new HttpError(404, 'busca desligada');
  const termo = (q.get('q') || '').trim();
  const partido = (q.get('partido') || '').trim().toUpperCase();
  // Com partido escolhido o termo é opcional: a busca lista todos os candidatos do partido.
  if (!partido && termo.length < 2 && !/^\d+$/.test(termo)) return { total: 0, itens: [], parcial: null, partidos: [] };
  const cargoId = q.get('cargo') || '';
  if (cargoId) await cargoDe(cargoId, flags);
  const ufFiltro = q.get('uf') ? validarUf(q.get('uf')) : '';
  const { itens: indice, listas, faltando } = await indiceBusca(cargoId, ufFiltro === 'br' ? '' : ufFiltro, flags);
  const partidos = [...new Set(indice.map((c) => c.partido))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  let hits = partido ? indice.filter((c) => c.partido.toUpperCase() === partido) : indice;
  if (/^\d+$/.test(termo)) {
    hits = hits.filter((c) => c.numero.startsWith(termo));
    hits.sort((a, b) => Number(b.numero === termo) - Number(a.numero === termo) || b.votos - a.votos);
  } else if (termo) {
    const tokens = normalizarTexto(termo).split(/\s+/).filter(Boolean);
    hits = hits.filter((c) => tokens.every((t) => c.chave.includes(t)));
    hits.sort((a, b) => b.votos - a.votos);
  } else {
    // Só o partido: agrupa por cargo (na ordem da config) e, dentro do cargo, por votos.
    const ordem = new Map((await getConfig()).cargos.map((c, i) => [c.id, i]));
    hits = [...hits].sort((a, b) => ordem.get(a.cargoId) - ordem.get(b.cargoId) || b.votos - a.votos);
  }
  // Por partido a lista pode passar de mil candidatos: o front pede em páginas ("Mostrar mais").
  const limite = Math.min(Number(q.get('limite') || 50), partido ? 5000 : 200);
  return {
    total: hits.length,
    itens: hits.slice(0, limite).map(({ chave, ...resto }) => resto),
    // Listas de candidatos (cargo × UF) que ainda não chegaram do TSE: a busca está incompleta.
    parcial: faltando ? { listas, faltando } : null,
    partidos,
  };
}
