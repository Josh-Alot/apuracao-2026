// Cache em memória das respostas do TSE (e do arquivo próprio), limitado pelo tamanho (LRU), com os validadores HTTP
// (ETag/Last-Modified) e a validade que o Akamai informa. O resultado normalizado fica junto do JSON (normalizadoEmCache).

/** @import { Resultado } from '../../compartilhado/api.mjs' */

// O cache é limitado (LRU pelo tamanho do JSON): sem limite, navegar pelos mapas estaduais guarda
// milhares de arquivos de município e estoura os 512 MB do Render gratuito (o processo trava e o
// health check falha). Em memória o JSON ocupa ~6x o tamanho do texto: 28 MB de texto ≈ 170 MB. Com 40 MB o
// processo chegou a 489 MB de RSS (somado ao índice do SEO e ao arquivo próprio) e foi reiniciado pelo Render.
const CACHE_MAX_BYTES = Number(process.env.CACHE_MB || 28) * 1024 * 1024;
/**
 * @typedef {{ ts: number, data: any, bytes: number, expira?: number, etag?: string | null, modificado?: string | null,
 *   norm?: Resultado | null, normBytes?: number }} EntradaCache
 */
// (ordem de inserção = do menos ao mais recente; `norm` = resultado já normalizado, ver deRaw)
/** @type {Map<string, EntradaCache>} */
const cache = new Map();
let cacheBytes = 0;

const pesoDe = (e) => e.bytes + (e.normBytes || 0);

function aparar() {
  for (const [u, e] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cache.delete(u);
    cacheBytes -= pesoDe(e);
  }
}

/** Guarda no cache. `meta` traz validade e validadores HTTP (expira, etag, modificado). */
export function guardar(url, data, bytes, meta = {}) {
  const antigo = cache.get(url);
  if (antigo) {
    cacheBytes -= pesoDe(antigo);
    cache.delete(url);
  }
  /** @type {EntradaCache} */
  const e = { ts: Date.now(), data, bytes, ...meta };
  // Mesmo JSON (resposta 304): aproveita a normalização já feita.
  if (antigo && antigo.data === data && antigo.norm) {
    e.norm = antigo.norm;
    e.normBytes = antigo.normBytes;
  }
  cache.set(url, e);
  cacheBytes += pesoDe(e);
  aparar();
}

// O Akamai do TSE guarda cada arquivo por ~60 s e informa quanto falta em `cache-control: max-age`.
// Antes disso, consultar de novo só devolve o mesmo arquivo — e gasta a cota da fila.
const MAX_AGE_TETO_S = 300;
export function metaHttp(res, antigo) {
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1]);
  return {
    expira: maxAge > 0 ? Date.now() + Math.min(maxAge, MAX_AGE_TETO_S) * 1000 : 0,
    etag: res.headers.get('etag') || antigo?.etag || null,
    modificado: res.headers.get('last-modified') || antigo?.modificado || null,
  };
}

/** O dado em cache ainda vale: pelo TTL pedido, até `validoAte` ou enquanto o Akamai não renova. */
export function vale(hit, ttlMs, validoAte = 0) {
  const agora = Date.now();
  return agora - hit.ts < ttlMs || agora < validoAte || agora < (hit.expira || 0);
}

export function lerCache(url) {
  const hit = cache.get(url);
  if (hit) { // marca como usado agora (vai para o fim da fila de descarte)
    cache.delete(url);
    cache.set(url, hit);
  }
  return hit;
}

/** Entrada em cache sem mexer na ordem de descarte (quem só consulta o que já está lá). */
export const espiar = (url) => cache.get(url);

/**
 * Resultado normalizado, guardado junto do JSON no cache: o mapa estadual lê centenas de arquivos a cada atualização e
 * o "ao vivo" relê o mesmo a cada 5 s — normalizar de novo só quando o JSON muda. O normalizado conta no limite do
 * cache (estimado em metade do tamanho do texto).
 * @param {(raw: any) => Resultado} normalizar
 */
export function normalizadoEmCache(url, raw, normalizar) {
  const e = cache.get(url);
  if (e?.data !== raw) return normalizar(raw);
  if (!e.norm) {
    e.norm = normalizar(raw);
    e.normBytes = e.bytes >> 1;
    cacheBytes += e.normBytes;
    aparar();
  }
  return e.norm;
}

export const estadoCache = () => ({ cache: cache.size, cacheMB: Math.round(cacheBytes / 2 ** 20) });
