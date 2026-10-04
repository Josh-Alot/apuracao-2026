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

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  pendentes++;
  avisar();
  try {
    const res = await fetch(url, { signal });
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

/**
 * Busca `url` e, se `intervalo` > 0, refaz a busca periodicamente.
 * Com `sseUrl`, em vez de consultar periodicamente, assina o stream "ao vivo" do servidor,
 * que empurra o dado sempre que o TSE publica algo novo.
 * Mantém o dado anterior enquanto recarrega ou troca de modo (evita "piscar" a tela).
 */
export function useApi<T>(url: string | null, intervalo = 0, sseUrl: string | null = null) {
  const [aoVivo, setAoVivo] = useState<AoVivo | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  /** Quando será a próxima consulta automática (ms desde epoch), ou null se não houver. */
  const [proxima, setProxima] = useState<number | null>(null);
  const urlAtual = useRef(url);
  const urlComDados = useRef<string | null>(null);

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
    const carregar = async () => {
      ctrl.abort();
      ctrl = new AbortController();
      const sinal = ctrl.signal;
      setCarregando(true);
      setProxima(intervalo > 0 ? Date.now() + intervalo : null);
      try {
        const d = await getJson<T>(url, sinal);
        if (urlAtual.current === url) {
          setData(d);
          setErro(null);
          urlComDados.current = url;
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (urlAtual.current === url) {
          setErro((e as Error).message);
          if (primeira) setData(null);
        }
      } finally {
        primeira = false;
        // Cancelada (troca de aba, nova consulta): quem a substituiu é que encerra o "carregando".
        if (!sinal.aborted && urlAtual.current === url) setCarregando(false);
      }
    };
    // Só limpa ao trocar de URL; ligar/desligar o "ao vivo" mantém o que já está na tela.
    // O erro da URL anterior também sai, senão a aba nova "herda" a falha enquanto carrega.
    if (urlComDados.current !== url) {
      setData(null);
      setErro(null);
    }

    if (sseUrl) {
      setProxima(null);
      setCarregando(urlComDados.current !== url);
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
        setData(JSON.parse(e.data));
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
    };
  }, [url, intervalo, sseUrl]);

  return { data, erro, carregando, proxima, aoVivo };
}
