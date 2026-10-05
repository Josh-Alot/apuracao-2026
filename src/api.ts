import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Local } from './types';

// ---------- contador global de requisições em andamento (alimenta a barra do topo) ----------

let pendentes = 0;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

/** true enquanto houver alguma requisição da API em andamento. */
export function useCarregandoGlobal() {
  return useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    () => pendentes > 0,
  );
}

// ---------- cache do cliente (mostra o último dado na hora e atualiza por trás) ----------
// Em memória para tudo que passa pelo useApi; espelhado no sessionStorage (só respostas pequenas)
// para o F5 também abrir com dado. Dado com mais de CACHE_VALIDADE_MS não é mostrado.

const CACHE_MAX_ITENS = 80;
const CACHE_VALIDADE_MS = 30 * 60_000;
const STORAGE_PREFIXO = 'apuracao:';
const STORAGE_MAX_CHARS = 150_000;
const memoria = new Map<string, { data: unknown; ts: number }>();

function lerCacheCliente<T>(url: string): T | null {
  let e = memoria.get(url);
  if (!e) {
    try {
      const txt = sessionStorage.getItem(STORAGE_PREFIXO + url);
      if (txt) e = JSON.parse(txt);
    } catch { /* storage bloqueado ou corrompido */ }
  }
  if (!e || Date.now() - e.ts > CACHE_VALIDADE_MS) return null;
  memoria.delete(url);
  memoria.set(url, e); // LRU: mais recente no fim
  return e.data as T;
}

function guardarCacheCliente(url: string, data: unknown) {
  const e = { data, ts: Date.now() };
  memoria.delete(url);
  memoria.set(url, e);
  while (memoria.size > CACHE_MAX_ITENS) memoria.delete(memoria.keys().next().value!);
  let txt: string;
  try {
    txt = JSON.stringify(e);
  } catch {
    return;
  }
  if (txt.length > STORAGE_MAX_CHARS) return;
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      sessionStorage.setItem(STORAGE_PREFIXO + url, txt);
      return;
    } catch {
      if (!liberarStorage()) return; // storage indisponível (ou nada mais a apagar)
    }
  }
}

/** Storage cheio: apaga as entradas mais antigas do app. Devolve false se não havia o que apagar. */
function liberarStorage() {
  try {
    const itens: { chave: string; ts: number }[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const chave = sessionStorage.key(i);
      if (!chave?.startsWith(STORAGE_PREFIXO)) continue;
      let ts = 0;
      try { ts = JSON.parse(sessionStorage.getItem(chave) || '{}').ts || 0; } catch { /* entrada inválida: sai primeiro */ }
      itens.push({ chave, ts });
    }
    if (!itens.length) return false;
    itens.sort((a, b) => a.ts - b.ts);
    for (const { chave } of itens.slice(0, Math.max(1, Math.ceil(itens.length / 4)))) sessionStorage.removeItem(chave);
    return true;
  } catch {
    return false;
  }
}

/** Tempo máximo de espera por uma resposta da API antes de desistir e mostrar o erro. */
const TIMEOUT_MS = 30_000;

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  pendentes++;
  avisar();
  const limite = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, limite]) : limite }).catch((e) => {
      if (limite.aborted && !signal?.aborted) {
        throw new Error(`o servidor não respondeu em ${TIMEOUT_MS / 1000} s (o TSE pode estar lento)`);
      }
      throw e;
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.erro || `Erro ${res.status}`);
    }
    return await res.json();
  } finally {
    pendentes--;
    avisar();
  }
}

export function qs(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  return p.toString();
}

export const urlResultado = (cargo: string, l: Local) =>
  `/api/resultado?${qs({ cargo, uf: l.uf ?? 'br', mun: l.mun, zona: l.zona })}`;

export const urlAoVivo = (cargo: string, l: Local) =>
  `/api/ao-vivo?${qs({ cargo, uf: l.uf ?? 'br', mun: l.mun, zona: l.zona })}`;

export const urlMapa = (cargo: string, uf: string, mun?: string) =>
  `/api/mapa?${qs({ cargo, uf, mun })}`;

/** Estado da conexão "ao vivo" (stream SSE). */
export interface AoVivo {
  /** De quanto em quanto tempo o servidor verifica o TSE (ms). */
  intervalo: number;
  /** Última verificação do servidor junto ao TSE (ms desde epoch). */
  verificadoEm: number | null;
  conectado: boolean;
}

/** Sem atualização periódica (apuração encerrada): espera para repetir uma busca que falhou ou veio incompleta. */
export const RETENTAR_MS = 15_000;

/**
 * Busca `url` e, se `intervalo` > 0, refaz a busca periodicamente.
 * Com `incompleto` e sem `intervalo`, repete a busca (a cada RETENTAR_MS) só enquanto ela falhar ou
 * `incompleto(dado)` — ex.: o mapa, cujas regiões o servidor completa aos poucos.
 * Com `sseUrl`, em vez de consultar periodicamente, assina o stream "ao vivo" do servidor,
 * que empurra o dado sempre que o TSE publica algo novo.
 * Mantém o dado anterior enquanto recarrega ou troca de modo (evita "piscar" a tela).
 */
export function useApi<T>(
  url: string | null, intervalo = 0, sseUrl: string | null = null, incompleto?: (d: T) => boolean,
) {
  const [aoVivo, setAoVivo] = useState<AoVivo | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  /** Quando será a próxima consulta automática (ms desde epoch), ou null se não houver. */
  const [proxima, setProxima] = useState<number | null>(null);
  const urlAtual = useRef(url);
  const urlComDados = useRef<string | null>(null);
  const incompletoAtual = useRef(incompleto);
  incompletoAtual.current = incompleto;

  useEffect(() => {
    urlAtual.current = url;
    if (!url) {
      setData(null);
      setErro(null);
      setProxima(null);
      urlComDados.current = null;
      return;
    }
    let ctrl = new AbortController();
    let primeira = true;
    let deCache = false; // a tela abriu com o dado do cache do cliente (ainda não confirmado pelo servidor)
    let retentar: ReturnType<typeof setTimeout> | undefined;
    const carregar = async () => {
      ctrl.abort();
      clearTimeout(retentar);
      ctrl = new AbortController();
      const sinal = ctrl.signal;
      let deNovo = false;
      setCarregando(true);
      setProxima(intervalo > 0 ? Date.now() + intervalo : null);
      try {
        const d = await getJson<T>(url, sinal);
        deNovo = !!incompletoAtual.current?.(d);
        guardarCacheCliente(url, d);
        if (urlAtual.current === url) {
          setData(d);
          setErro(null);
          urlComDados.current = url;
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        deNovo = !!incompletoAtual.current;
        if (urlAtual.current === url) {
          setErro((e as Error).message);
          if (primeira && !deCache) setData(null); // com dado do cache, melhor mantê-lo junto do erro
        }
      } finally {
        primeira = false;
        // Cancelada (troca de aba, nova consulta): quem a substituiu é que encerra o "carregando".
        if (!sinal.aborted && urlAtual.current === url) setCarregando(false);
        if (deNovo && !intervalo && !sinal.aborted) {
          retentar = setTimeout(carregar, RETENTAR_MS);
          setProxima(Date.now() + RETENTAR_MS);
        }
      }
    };
    // Só troca o dado ao mudar de URL; ligar/desligar o "ao vivo" mantém o que já está na tela.
    // Com a URL já vista (cache do cliente), o último dado aparece na hora enquanto atualiza;
    // sem cache, a tela volta ao esqueleto. O erro da URL anterior também sai, senão a aba nova
    // "herda" a falha enquanto carrega.
    if (urlComDados.current !== url) {
      const emCache = lerCacheCliente<T>(url);
      setData(emCache);
      setErro(null);
      deCache = !!emCache;
      if (emCache) urlComDados.current = url;
    }

    if (sseUrl) {
      setProxima(null);
      setCarregando(urlComDados.current !== url || deCache);
      const es = new EventSource(sseUrl);
      let estado: AoVivo = { intervalo: 0, verificadoEm: null, conectado: false };
      const atualizar = (parcial: Partial<AoVivo>) => {
        estado = { ...estado, ...parcial };
        if (urlAtual.current === url) setAoVivo(estado);
      };
      es.onopen = () => atualizar({ conectado: true });
      es.onerror = () => atualizar({ conectado: false }); // o EventSource reconecta sozinho
      es.addEventListener('config', (e) => atualizar({ intervalo: JSON.parse(e.data).intervalo }));
      es.addEventListener('verificado', (e) => atualizar({ verificadoEm: Number(e.data), conectado: true }));
      es.addEventListener('resultado', (e) => {
        if (urlAtual.current !== url) return;
        const d = JSON.parse(e.data);
        guardarCacheCliente(url, d);
        setData(d);
        setErro(null);
        setCarregando(false);
        urlComDados.current = url;
      });
      es.addEventListener('erro', (e) => {
        if (urlAtual.current !== url) return;
        setErro(JSON.parse((e as MessageEvent).data).erro);
        setCarregando(false);
      });
      return () => {
        es.close();
        setAoVivo(null);
      };
    }

    carregar();
    const id = intervalo > 0 ? setInterval(carregar, intervalo) : undefined;
    return () => {
      ctrl.abort();
      clearInterval(id);
      clearTimeout(retentar);
    };
  }, [url, intervalo, sseUrl]);

  return { data, erro, carregando, proxima, aoVivo };
}
