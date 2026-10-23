// GET /api/config (config do TSE + situação da apuração + flags) e GET /api/municipios.

import { getConfig, getMunicipios, apuracaoEncerrada } from '../tse.mjs';
import { cargoVisivel } from '../flags.mjs';
import { cargoDe } from '../http.mjs';
/** @import { Config, Flags, Municipios } from '../../compartilhado/api.mjs' */

/**
 * Configuração + `encerrada` por cargo (com a apuração encerrada o front não fica consultando o TSE),
 * só com os cargos que as flags liberam — o turno mais recente primeiro, que é o que o front abre —
 * e as flags, para o front esconder o que estiver desligado.
 *
 * @param {URLSearchParams} _q
 * @param {Flags} flags
 * @returns {Promise<Config>}
 */
export async function configComSituacao(_q, flags) {
  const cfg = await getConfig();
  const cargos = cfg.cargos.filter((c) => cargoVisivel(c, flags));
  const eleicoes = [...new Set(cargos.map((c) => c.eleicao))];
  const encerradas = new Map(await Promise.all(eleicoes.map(async (e) => /** @type {[string, boolean]} */ ([e, await apuracaoEncerrada(e)]))));
  return {
    ...cfg,
    cargos: cargos.map((c) => ({ ...c, encerrada: encerradas.get(c.eleicao) })).sort((a, b) => b.turno - a.turno),
    flags,
  };
}

/**
 * @param {URLSearchParams} q
 * @param {Flags} flags
 * @returns {Promise<Municipios | null>}
 */
export async function listaMunicipios(q, flags) {
  const c = await cargoDe(q.get('cargo'), flags);
  return getMunicipios(c.eleicao);
}
