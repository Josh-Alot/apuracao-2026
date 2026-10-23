// Erros HTTP e validação dos parâmetros comuns às rotas da API.

import { getConfig, UFS } from './tse.mjs';
import { cargoVisivel } from './flags.mjs';

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

/** Cargo pelo id; um cargo escondido por flag (ex.: 2º turno antes da hora) responde como desconhecido. */
export async function cargoDe(id, flags) {
  const cfg = await getConfig();
  const c = cfg.cargos.find((x) => x.id === id);
  if (!c || !cargoVisivel(c, flags)) throw new HttpError(400, `cargo desconhecido: ${id}`);
  return c;
}

/** UF da query (ou 'br'/'zz'), em minúsculas; inválida = 400. */
export const validarUf = (s) => {
  const v = String(s || '').toLowerCase();
  if (v !== 'br' && v !== 'zz' && !UFS.includes(v)) throw new HttpError(400, `UF inválida: ${s}`);
  return v;
};
