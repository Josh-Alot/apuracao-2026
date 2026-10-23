// GET /api/mapa: resumo (líder, 2º, % apurado) de cada região do mapa: UFs, municípios ou zonas.

import { getConfig, getMunicipios, getResultadosRapidos, getAbrangencia, resumo, PRIORIDADE } from '../tse.mjs';
import { cargoDe, validarUf } from '../http.mjs';
/** @import { Flags, MapaDados } from '../../compartilhado/api.mjs' */

/**
 * @param {URLSearchParams} q
 * @param {Flags} flags
 * @returns {Promise<MapaDados>}
 */
export async function mapa(q, flags) {
  const c = await cargoDe(q.get('cargo'), flags);
  const u = validarUf(q.get('uf') || 'br');
  const mun = q.get('mun');
  const base = { eleicao: c.eleicao, cargo: c.cargo };

  // Para colorir o mapa basta o líder: com todas as seções totalizadas ele não muda mais.
  const opcoes = { ttlCompletoMs: 30 * 60_000 };

  // 2º turno: o resultado do 1º turno nas mesmas regiões (do arquivo próprio, já final) mostra onde virou.
  const primeiro = c.primeiroTurno ? (await getConfig()).cargos.find((x) => x.id === c.primeiroTurno) : null;
  const montar = async (chaves, lista, ttl, prioridade) => {
    const [rs, r1s] = await Promise.all([
      getResultadosRapidos(lista, ttl, prioridade, opcoes),
      primeiro
        ? getResultadosRapidos(lista.map((p) => ({ ...p, eleicao: primeiro.eleicao })), ttl, PRIORIDADE.baixa, opcoes)
        : null,
    ]);
    return Object.fromEntries(chaves.map((k, i) => [k, resumo(rs[i], r1s ? r1s[i] ?? null : undefined)]));
  };

  if (u === 'br') {
    const ufs = c.ufs;
    return montar(ufs, ufs.map((x) => ({ ...base, uf: x })), 30_000, PRIORIDADE.media);
  }

  const municipios = (await getMunicipios(c.eleicao))?.[u]?.municipios ?? [];
  if (mun) {
    const zonas = municipios.find((m) => m.cd === mun)?.zonas ?? [];
    return montar(zonas, zonas.map((z) => ({ ...base, uf: u, mun, zona: z })), 60_000, PRIORIDADE.baixa);
  }

  // Cargos proporcionais têm arquivos grandes (milhares de candidatos) — para o mapa
  // estadual usamos só o % apurado, que vem de um único arquivo de abrangência.
  if (c.tipo === 'proporcional') return getAbrangencia(c.eleicao, u);

  // Um arquivo por município (853 em MG): entram na fila com prioridade baixa e o mapa vai se
  // completando a cada atualização, em vez de disparar centenas de consultas de uma vez.
  return montar(municipios.map((m) => m.cd), municipios.map((m) => ({ ...base, uf: u, mun: m.cd })), 3 * 60_000, PRIORIDADE.baixa);
}
