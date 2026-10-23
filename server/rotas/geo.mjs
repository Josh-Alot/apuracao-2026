// Malhas do IBGE (/api/geo/<uf|br>, texto pronto em memória) e o contorno estimado das zonas (/api/zonas).

import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { lerMalha } from '../malhas.mjs';
import { HttpError, validarUf } from '../http.mjs';
/** @import {  } from '../../compartilhado/api.mjs' */

// Malha já pronta para enviar (texto do JSON, ~11 MB com todas as UFs): ler e descompactar a cada pedido custava
// CPU e memória (MG tem 1,6 MB). A promessa entra no mapa logo no 1º pedido, para os pedidos simultâneos esperarem
// a mesma leitura; se falhar, fica até `IBGE_PAUSA_MS` antes de o IBGE ser tentado de novo (o front repete a cada
// 15 s: sem a pausa, cada aba aberta viraria uma consulta ao IBGE fora do ar).
const IBGE_PAUSA_MS = 30_000;
const malhas = new Map(); // alvo -> Promise<string>

/** Malhas já em memória (para o alerta de memória). */
export const malhasEmMemoria = () => malhas.size;

export function geo(alvo) {
  let p = malhas.get(alvo);
  if (!p) {
    p = lerMalha(alvo).then((texto) => {
      if (texto === null) throw new HttpError(404, 'malha não encontrada');
      return texto;
    }, (err) => {
      console.warn(`Falha ao consultar a malha ${alvo} do IBGE: ${err.message}`);
      throw Object.assign(new HttpError(502, `Falha ao consultar a malha do IBGE: ${err.message}`), { silencioso: true });
    });
    malhas.set(alvo, p);
    p.catch(() => setTimeout(() => malhas.delete(alvo), IBGE_PAUSA_MS).unref());
  }
  return p;
}

// Contorno estimado das zonas nos municípios com mais de uma zona (gerado por `npm run zonas`, ~0,3 MB):
// lido no 1º pedido e mantido em memória.
// Passa pelo json() das rotas (ETag + no-cache): uma regeração do arquivo chega ao navegador no deploy seguinte.
const ZONAS = new URL('../../dados/zonas-2026.json.gz', import.meta.url);
let zonasGeo = null;
export async function geoZonas(q) {
  validarUf(q.get('uf'));
  const mun = q.get('mun');
  if (!/^\d{5}$/.test(mun || '')) throw new HttpError(400, 'município inválido');
  zonasGeo ??= fs.readFile(ZONAS)
    .then((b) => JSON.parse(zlib.gunzipSync(b).toString()))
    .catch(() => ({ municipios: {} }));
  const { municipios, gerado } = await zonasGeo;
  const zonas = municipios[mun];
  if (!zonas) throw new HttpError(404, 'município sem contorno de zonas');
  return {
    type: 'FeatureCollection',
    mun,
    gerado,
    features: Object.entries(zonas).map(([zona, coordinates]) => ({
      type: 'Feature', properties: { zona }, geometry: { type: 'MultiPolygon', coordinates },
    })),
  };
}
