import { useSyncExternalStore } from 'react';
import type { Local } from '../lib/types';

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

// ---------- cache do cliente no sessionStorage (para o F5 abrir com dado) ----------
// O cache em memória é o do TanStack Query (useConsulta); aqui ficam só as respostas pequenas, para a página
// recarregada mostrar o último dado na hora. Dado com mais de CACHE_VALIDADE_MS não é mostrado.

export const CACHE_VALIDADE_MS = 30 * 60_000;
const STORAGE_PREFIXO = 'apuracao:';
const STORAGE_MAX_CHARS = 150_000;

export function lerCacheCliente<T>(url: string): { data: T; ts: number } | undefined {
  let e: { data: T; ts: number } | undefined;
  try {
    const txt = sessionStorage.getItem(STORAGE_PREFIXO + url);
    if (txt) e = JSON.parse(txt);
  } catch { /* storage bloqueado ou corrompido */ }
  if (!e || Date.now() - e.ts > CACHE_VALIDADE_MS) return undefined;
  return e;
}

export function guardarCacheCliente(url: string, data: unknown) {
  let txt: string;
  try {
    txt = JSON.stringify({ data, ts: Date.now() });
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
