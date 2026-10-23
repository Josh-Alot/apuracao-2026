import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { consultas } from '../api/consultas';
import type { Config } from '../lib/types';
import { resolverTela } from '../rota/resolver';
import { lerCaminho } from '../rotas.mjs';

/**
 * Ponteiro sobre um link interno: o resultado da tela de destino começa a vir antes do clique. Só o resultado
 * (barato e com cache no servidor); o mapa de uma UF custa centenas de consultas ao TSE e fica para o clique.
 */
export function usePrefetch(config: Config | null, vale: number) {
  const qc = useQueryClient();
  return useCallback((href: string) => {
    if (!config) return;
    const lida = lerCaminho(href);
    if (!lida || lida.candidato !== undefined) return;
    const destino = resolverTela(config, lida);
    if (!destino.cargo || (destino.cargo.escopo === 'uf' && !destino.uf)) return;
    qc.prefetchQuery(consultas.resultado(destino.cargo.id, destino.local, vale));
  }, [config, vale, qc]);
}
