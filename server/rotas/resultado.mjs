// GET /api/resultado: resultado normalizado de uma abrangência (Brasil, UF, município ou zona).

import { getResultado } from '../tse.mjs';
import { HttpError, cargoDe, validarUf } from '../http.mjs';
/** @import { Flags, ParamsResultado, Resultado } from '../../compartilhado/api.mjs' */

/**
 * @param {URLSearchParams} q
 * @param {Flags} flags
 * @returns {Promise<ParamsResultado>}
 */
export async function paramsResultado(q, flags) {
  const c = await cargoDe(q.get('cargo'), flags);
  const mun = q.get('mun') || undefined;
  const zona = q.get('zona') || undefined;
  if ((mun && !/^\d{5}$/.test(mun)) || (zona && !/^\d{1,4}$/.test(zona))) throw new HttpError(400, 'município/zona inválidos');
  return { eleicao: c.eleicao, cargo: c.cargo, uf: validarUf(q.get('uf') || 'br'), mun, zona };
}

/**
 * @param {URLSearchParams} q
 * @param {Flags} flags
 * @returns {Promise<Resultado>}
 */
export async function resultado(q, flags) {
  const params = await paramsResultado(q, flags);
  const r = await getResultado(params);
  if (!r) throw new HttpError(404, 'Sem dados para esta abrangência/cargo.');
  return r;
}
