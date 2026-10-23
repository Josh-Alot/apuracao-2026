import { useCallback, useEffect, useRef, useState } from 'react';
import type { Local } from '../lib/types';
import { lerCaminho } from '../../compartilhado/rotas.mjs';

// ---------- rota no caminho da URL (formato em rotas.mjs, o mesmo do servidor) ----------

/** Tela do funil. `cargo` = slug da URL (ex. "governador"); num link antigo (#/6257-1/…), o id da config. */
export interface Tela extends Local { cargo?: string }

/** Estado guardado no history junto de /candidato/<sq>: a tela por baixo da ficha e se ela foi aberta no app. */
export interface EstadoFicha { base: Tela; dentro: boolean }

/** Estado guardado no history junto de uma tela do funil (ver `Rota.ufFora`). */
export interface EstadoTela { ufFora?: string }

export interface Rota {
  tela: Tela;
  /** Ficha aberta (sq do candidato). */
  candidato?: string;
  /** Tela por baixo da ficha já conhecida (veio do history); senão, sai da busca pelo nome da URL. */
  temBase?: boolean;
  /** A ficha foi aberta de dentro do app: fechar = voltar no histórico. */
  dentro?: boolean;
  /** Link antigo no hash: o caminho novo é escrito assim que a config chega. */
  legado?: boolean;
  /**
   * UF de onde o leitor veio quando o cargo de destino não tem 2º turno nela (o caminho volta ao Brasil): a tela
   * avisa. Só na navegação dentro do app (fica no history.state; o caminho com a UF seria um 404).
   */
  ufFora?: string;
}

/** Tela de um caminho do funil (`{}` para a home, um caminho inválido ou o de uma ficha). */
export function telaDe(pathname: string): Tela {
  const r = lerCaminho(pathname);
  return r && r.candidato === undefined ? r : {};
}

function lerRota(): Rota {
  // Links antigos: #/<cargoId>/<uf>/<mun>/<zona>
  const hash = /^#\/(.*)$/.exec(location.hash);
  if (hash) {
    const [cargo, uf, mun, zona] = hash[1].split('/').filter(Boolean);
    return { tela: { cargo, uf, mun, zona }, legado: true };
  }
  const r = lerCaminho(location.pathname);
  // Formato inválido (o servidor já respondeu 404): mostra a tela padrão.
  if (!r) return { tela: {} };
  if (r.candidato !== undefined) {
    const st = history.state as EstadoFicha | null;
    return st?.base
      ? { tela: st.base, candidato: r.candidato, temBase: true, dentro: st.dentro }
      : { tela: {}, candidato: r.candidato };
  }
  return { tela: r, ufFora: (history.state as EstadoTela | null)?.ufFora };
}

/** Rota atual, lida da URL e relida a cada voltar/avançar do navegador. */
export function useRota() {
  const [rota, setRotaEstado] = useState<Rota>(lerRota);
  // Cópia para os handlers não dependerem do render (ex.: fechar a ficha duas vezes antes do popstate).
  const rotaRef = useRef(rota);
  const setRota = useCallback((r: Rota) => { rotaRef.current = r; setRotaEstado(r); }, []);

  useEffect(() => {
    const on = () => setRota(lerRota());
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, [setRota]);

  return { rota, rotaRef, setRota };
}
