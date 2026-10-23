// Busca de JSON com cache, deduplicação, fila do TSE e o arquivo próprio como reserva (ou fonte única).

import { ARQUIVO_FORCADO, doArquivo, eleicaoFinal } from '../arquivo.mjs';
import { guardar, lerCache, metaHttp, vale } from './cache.mjs';
import { PRIORIDADE, aguardarVez, pausadoAte, promover, tseLimitou, tseRespondeu } from './fila.mjs';
import { TSE_BASE } from './urls.mjs';

/** Erro de consulta ao TSE que já foi registrado no log de forma resumida (sem pilha). */
export class ErroTse extends Error {
  constructor(msg, status = 503) { super(msg); this.status = status; this.silencioso = true; }
}

const inflight = new Map(); // url -> Promise
// Falhas que não são 429 (5xx, rede) pausam só aquela URL por alguns segundos.
const falhaAte = new Map(); // url -> ms
const FALHA_MS = 5_000;

// Arquivo próprio (arquivo/, `npm run arquivar`): é a única fonte do que ele cobre com ARQUIVO=1 ou
// quando a eleição está toda final no manifesto (`eleicaoFinal`); fora isso, entra quando o TSE falha ou
// não tem mais o arquivo, e o TSE é tentado de novo após 60 s.
// A configuração geral é exceção: vem sempre do TSE (é ela que traz o 2º turno e eleições novas) e o
// arquivo só entra se o TSE falhar.
const ARQUIVO_TTL_MS = 60_000;
export const CONFIG_URL = `${TSE_BASE}/comum/config/ele-c.json`;

/** Dado do arquivo próprio para a URL (guardado no cache), ou undefined se o arquivo não a cobre. */
async function doArquivoEmCache(url, fonteUnica = false) {
  const data = await doArquivo(url, TSE_BASE).catch((err) => {
    console.warn(`Falha ao ler o arquivo próprio para ${url}: ${err.message}`);
    return undefined;
  });
  if (data !== undefined) {
    const expira = fonteUnica ? Infinity : Date.now() + ARQUIVO_TTL_MS;
    guardar(url, data, JSON.stringify(data).length, { expira });
  }
  return data;
}

/**
 * Busca JSON com cache: vale por `ttlMs` ou, se informado, até o instante `validoAte` (ms).
 * Consultas ao TSE entram na fila com a `prioridade` dada.
 */
export async function fetchJson(url, ttlMs, validoAte = 0, prioridade = PRIORIDADE.alta) {
  const hit = lerCache(url);
  if (hit && vale(hit, ttlMs, validoAte)) return hit.data;
  if (inflight.has(url)) {
    promover(url, prioridade);
    return inflight.get(url);
  }
  const doTse = url.startsWith(TSE_BASE);
  const forcado = doTse && url !== CONFIG_URL && (ARQUIVO_FORCADO || eleicaoFinal(url, TSE_BASE));
  if (forcado) {
    const data = await doArquivoEmCache(url, true);
    if (data !== undefined) return data;
  }
  return fetchSemArquivo(url, hit, prioridade, doTse && !forcado);
}

async function fetchSemArquivo(url, hit, prioridade, comArquivo) {
  const doTse = url.startsWith(TSE_BASE);
  const espera = Math.max(doTse ? pausadoAte() : 0, falhaAte.get(url) ?? 0) - Date.now();
  if (espera > 0) {
    if (hit) return hit.data;
    if (comArquivo) {
      const data = await doArquivoEmCache(url);
      if (data !== undefined) return data;
    }
    throw new ErroTse(`Consulta ao ${doTse ? 'TSE' : 'serviço externo'} pausada após falha; nova tentativa em ${Math.ceil(espera / 1000)} s`);
  }

  const p = (async () => {
    try {
      if (doTse && !(await aguardarVez(url, prioridade))) {
        throw new ErroTse('Consulta ao TSE descartada (fila cheia)');
      }
      // Requisição condicional: se o arquivo não mudou, o TSE responde 304 sem corpo e o JSON
      // (e a normalização) em cache continuam valendo.
      const headers = { 'user-agent': 'apuracao-2026/0.1' };
      if (hit?.data && hit.etag) headers['if-none-match'] = hit.etag;
      else if (hit?.data && hit.modificado) headers['if-modified-since'] = hit.modificado;
      const res = await fetch(url, { headers });
      if (res.status === 304 && hit?.data) {
        guardar(url, hit.data, hit.bytes, metaHttp(res, hit));
        falhaAte.delete(url);
        if (doTse) tseRespondeu();
        return hit.data;
      }
      if (res.status === 404 || res.status === 403) {
        // O TSE pode tirar os arquivos do ar no futuro: o arquivo próprio continua respondendo.
        const data = comArquivo ? await doArquivoEmCache(url) : undefined;
        if (data !== undefined) return data;
        guardar(url, null, 0);
        return null;
      }
      if (res.status === 429 && doTse) {
        tseLimitou(res);
        throw new ErroTse('TSE limitou as consultas (HTTP 429); tentando de novo em instantes');
      }
      if (!res.ok) throw new ErroTse(`HTTP ${res.status} em ${url}`, 502);
      const texto = await res.text();
      const data = JSON.parse(texto);
      guardar(url, data, texto.length, metaHttp(res));
      falhaAte.delete(url);
      if (doTse) tseRespondeu();
      return data;
    } catch (err) {
      if (!(err instanceof ErroTse) || err.status === 502) {
        falhaAte.set(url, Date.now() + FALHA_MS);
        // `fetch failed` sozinho não diz nada: a causa (certificado, DNS, conexão) vem em `err.cause`.
        if (!(err instanceof ErroTse)) console.warn(`Falha ao consultar ${url}: ${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`);
      }
      if (hit) return hit.data; // devolve dado antigo se o TSE oscilar
      if (comArquivo) {
        const data = await doArquivoEmCache(url);
        if (data !== undefined) return data;
      }
      throw err instanceof ErroTse ? err : new ErroTse(`Falha ao consultar o TSE: ${err.message}`, 502);
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

/** Executa `fn` sobre `items` com no máximo `limit` promessas simultâneas. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}
