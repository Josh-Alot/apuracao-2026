import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type AoVivo, RETENTAR_MS, guardarCacheCliente, lerCacheCliente } from './cliente';
import type { Consulta } from './consultas';

interface Opcoes<T> {
  /** > 0: refaz a consulta periodicamente (ms). */
  intervalo?: number;
  /**
   * Sem `intervalo`: repete a consulta (a cada RETENTAR_MS) só enquanto ela falhar ou `incompleto(dado)` — ex.: o
   * mapa, cujas regiões o servidor completa aos poucos.
   */
  incompleto?: (d: T) => boolean;
  /** Stream "ao vivo" do servidor: no lugar das consultas, o dado chega sempre que o TSE publica algo novo. */
  sse?: string | null;
}

/**
 * Dado de uma consulta, com cache do TanStack Query (mesma chave = uma requisição só, para todos os componentes).
 * Ao trocar de tela, o último dado daquela URL (em memória ou no sessionStorage, para o F5) aparece na hora
 * enquanto atualiza; URL nunca vista volta ao esqueleto. Ligar/desligar o "ao vivo" mantém o que está na tela.
 */
export function useConsulta<T>(c: Consulta<T> | null, { intervalo = 0, incompleto, sse = null }: Opcoes<T> = {}) {
  const stream = useStream(c, sse);
  const q = useQuery<T, Error, T, readonly unknown[]>({
    queryKey: c?.queryKey ?? ['nenhuma'],
    queryFn: c?.queryFn,
    enabled: !!c && !sse,
    staleTime: c?.staleTime ?? 0,
    // Dado do sessionStorage (F5): aparece na hora, mas conta como vencido, para ser confirmado pelo servidor
    // mesmo nas consultas que valem para sempre (config, municípios).
    initialData: () => (c ? lerCacheCliente<T>(c.url)?.data : undefined),
    initialDataUpdatedAt: 0,
    refetchInterval: (query) => ritmo(query.state.data, query.state.error),
  });

  function ritmo(dado: T | undefined, erro: unknown) {
    if (!c || sse) return 0;
    if (intervalo > 0) return intervalo;
    return incompleto && (erro || (dado !== undefined && incompleto(dado))) ? RETENTAR_MS : 0;
  }

  const r = ritmo(q.data, q.error);
  const ultima = Math.max(q.dataUpdatedAt, q.errorUpdatedAt);
  return {
    data: c ? q.data ?? null : null,
    erro: !c ? null : sse ? stream.erro : q.error?.message ?? null,
    carregando: !!c && (sse ? !stream.recebeu : q.isFetching),
    /** Quando será a próxima consulta automática (ms desde epoch), ou null se não houver. */
    proxima: r && ultima ? ultima + r : null,
    aoVivo: stream.aoVivo,
  };
}

interface EstadoStream { aoVivo: AoVivo | null; erro: string | null; recebeu: boolean }
const PARADO: EstadoStream = { aoVivo: null, erro: null, recebeu: false };

/** Assina o SSE e grava cada resultado no cache da consulta (os componentes que a usam se atualizam sozinhos). */
function useStream<T>(c: Consulta<T> | null, sse: string | null): EstadoStream {
  const qc = useQueryClient();
  const [estado, setEstado] = useState<EstadoStream>(PARADO);
  const chave = c?.queryKey;
  const url = c?.url;

  useEffect(() => {
    if (!sse || !chave || !url) return;
    const es = new EventSource(sse);
    let aoVivo: AoVivo = { intervalo: 0, verificadoEm: null, conectado: false };
    const atualizar = (parcial: Partial<AoVivo>) => {
      aoVivo = { ...aoVivo, ...parcial };
      setEstado((e) => ({ ...e, aoVivo }));
    };
    es.onopen = () => atualizar({ conectado: true });
    es.onerror = () => atualizar({ conectado: false }); // o EventSource reconecta sozinho
    es.addEventListener('config', (e) => atualizar({ intervalo: JSON.parse(e.data).intervalo }));
    es.addEventListener('verificado', (e) => atualizar({ verificadoEm: Number(e.data), conectado: true }));
    es.addEventListener('resultado', (e) => {
      const d = JSON.parse(e.data) as T;
      guardarCacheCliente(url, d);
      qc.setQueryData(chave, d);
      setEstado((s) => ({ ...s, erro: null, recebeu: true }));
    });
    es.addEventListener('erro', (e) => {
      setEstado((s) => ({ ...s, erro: JSON.parse((e as MessageEvent).data).erro, recebeu: true }));
    });
    return () => {
      es.close();
      setEstado(PARADO);
    };
  }, [sse, url]);

  return estado;
}
