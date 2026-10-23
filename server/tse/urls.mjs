// Endereços dos arquivos do TSE (resultados.tse.jus.br/oficial) e as UFs.

import { eleicaoDaFoto } from '../simulacao.mjs';
/** @import { ParamsResultado } from '../../compartilhado/api.mjs' */

export const TSE_BASE = 'https://resultados.tse.jus.br/oficial';
export const CICLO = process.env.CICLO || 'ele2026';

export const UFS = [
  'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa',
  'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to',
];

export const pad = (s, n) => String(s).padStart(n, '0');

/** @param {ParamsResultado} params */
export function resultadoUrl({ eleicao, cargo, uf, mun, zona }) {
  let abr = uf;
  if (mun) abr += mun;
  if (zona) abr += `-z${pad(zona, 4)}`;
  return `${TSE_BASE}/${CICLO}/${eleicao}/dados/${uf}/${abr}-c${pad(cargo, 4)}-e${pad(eleicao, 6)}-u.json`;
}

export function fotoUrl(eleicao, uf, sqcand) {
  return `${TSE_BASE}/${CICLO}/${eleicaoDaFoto(eleicao)}/fotos/${uf}/${sqcand}.jpeg`;
}
