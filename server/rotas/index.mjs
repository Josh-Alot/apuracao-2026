// Rotas JSON da API: caminho → handler (query, flags) → resposta. Cada handler declara o tipo da resposta
// (compartilhado/api.d.mts) e o `npm run typecheck` confere o que ele monta contra o que o front lê.
// Rotas com resposta especial (malhas, candidato, SSE, prévia/flags) ficam no despacho do server/index.mjs.

import { configComSituacao, listaMunicipios } from './config.mjs';
import { resultado } from './resultado.mjs';
import { mapa } from './mapa.mjs';
import { busca } from './busca.mjs';
import { composicao } from './composicao.mjs';
import { geoZonas } from './geo.mjs';
import { saude } from './saude.mjs';

export const ROTAS_JSON = {
  '/api/config': configComSituacao,
  '/api/municipios': listaMunicipios,
  '/api/resultado': resultado,
  '/api/mapa': mapa,
  '/api/busca': busca,
  '/api/composicao': composicao,
  '/api/zonas': geoZonas,
  '/api/saude': saude,
};
