import type { FeatureCollection } from 'geojson';
import type { Composicao, Config, DetalheCandidato, Local, MapaDados, Municipios, Resultado } from '../lib/types';
import { getJson, guardarCacheCliente, urlMapa, urlResultado } from './cliente';

/**
 * Uma consulta à API: chave do cache do TanStack Query (recurso + URL), a função que busca e por quanto tempo o
 * dado vale sem nova consulta (`staleTime`). Serve tanto ao `useConsulta` quanto ao `prefetchQuery`/`fetchQuery`.
 */
export interface Consulta<T> {
  queryKey: readonly [string, string];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>;
  staleTime: number;
  url: string;
}

function consulta<T>(recurso: string, url: string, staleTime: number): Consulta<T> {
  return {
    queryKey: [recurso, url],
    queryFn: async ({ signal }) => {
      const d = await getJson<T>(url, signal);
      guardarCacheCliente(url, d);
      return d;
    },
    staleTime,
    url,
  };
}

/** Durante a apuração: o mesmo cache do servidor para UF/BR (20 s). Antes das 17h ou encerrada: 5 min. */
export const VALE_APURANDO_MS = 20_000;
export const VALE_PARADO_MS = 5 * 60_000;
/**
 * O que não muda durante a visita (config, municípios, malhas). Não é Infinity: com Infinity o TanStack nunca
 * consulta, nem o dado que veio do sessionStorage (que precisa ser confirmado ao abrir a página).
 */
const VALE_SEMPRE_MS = 24 * 60 * 60_000;

/** Tudo o que o front consulta, num lugar só: a URL de cada recurso e por quanto tempo ele vale. */
export const consultas = {
  /** Lida uma vez por página (a aba aberta durante a apuração segue com a config que leu). */
  config: () => consulta<Config>('config', '/api/config', VALE_SEMPRE_MS),
  municipios: (eleicao: string, cargo: string) =>
    consulta<Municipios>('municipios', `/api/municipios?cargo=${eleicao}-${cargo}`, VALE_SEMPRE_MS),
  geo: (uf: string) => consulta<FeatureCollection>('geo', `/api/geo/${uf}`, VALE_SEMPRE_MS),
  zonas: (uf: string, mun: string) =>
    consulta<FeatureCollection & { mun: string }>('zonas', `/api/zonas?uf=${uf}&mun=${mun}`, VALE_SEMPRE_MS),
  mapa: (cargoId: string, uf: string, mun: string | undefined, vale: number) =>
    consulta<MapaDados>('mapa', urlMapa(cargoId, uf, mun), vale),
  resultado: (cargoId: string, local: Local, vale: number) =>
    consulta<Resultado>('resultado', urlResultado(cargoId, local), vale),
  composicao: (cargoId: string, uf: string | undefined, vale: number) =>
    consulta<Composicao>('composicao', `/api/composicao?cargo=${cargoId}${uf ? `&uf=${uf}` : ''}`, vale),
  candidato: (sq: string) => consulta<DetalheCandidato>('candidato', `/api/candidato/${sq}`, VALE_PARADO_MS),
};
