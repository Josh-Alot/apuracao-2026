import { type RefObject, useCallback, useEffect } from 'react';
import type { Candidato, Cargo, Config, Local, Municipios } from '../lib/types';
import { caminho, caminhoCandidato, slugCargo } from '../rotas.mjs';
import { type EstadoFicha, type Rota, telaDe } from './rota';

interface Params {
  config: Config | null;
  cargo: Cargo | undefined;
  municipios: Municipios | null;
  /** Tela efetiva (UF já validada para o cargo). */
  local: Local;
  rota: Rota;
  rotaRef: RefObject<Rota>;
  setRota: (r: Rota) => void;
  /** Chamado por `ir`/`irHome` (ex.: limpar o filtro vindo da busca). */
  aoSair: () => void;
}

/** Caminhos e navegação do funil (pushState/replaceState), no formato de rotas.mjs. */
export function useNavegacao({ config, cargo, municipios, local, rota, rotaRef, setRota, aoSair }: Params) {
  /** Caminho de uma tela (cargo = id da config), com o nome do município quando a lista já chegou. */
  const caminhoDe = useCallback(
    (l: Local, cargoId = cargo?.id) => {
      const c = config?.cargos.find((x) => x.id === cargoId);
      const munNome = l.uf && l.mun ? municipios?.[l.uf]?.municipios.find((m) => m.cd === l.mun)?.nome : undefined;
      return caminho({ cargo: c && slugCargo(c), uf: l.uf, mun: l.mun, munNome, zona: l.zona });
    },
    [config, cargo?.id, municipios],
  );

  /** Navega para uma tela (nova entrada no histórico); `ir` também chama `aoSair`. */
  const irPara = useCallback(
    (l: Local, cargoId = cargo?.id) => {
      const destino = caminhoDe(l, cargoId);
      if (destino !== location.pathname || location.hash || rotaRef.current.candidato) history.pushState(null, '', destino);
      setRota({ tela: telaDe(destino) });
    },
    [caminhoDe, cargo?.id, setRota],
  );
  const ir = useCallback(
    (l: Local, cargoId = cargo?.id) => {
      aoSair();
      irPara(l, cargoId);
    },
    [irPara, cargo?.id, aoSair],
  );
  /** Home (/): o cargo padrão no Brasil, sem ficha aberta. */
  const irHome = useCallback(() => {
    aoSair();
    if (location.pathname !== '/' || location.hash || rotaRef.current.candidato) history.pushState(null, '', '/');
    setRota({ tela: {} });
  }, [setRota, aoSair]);

  // Link antigo (#/6257-1/sp/…): troca pelo caminho novo sem recarregar a página.
  useEffect(() => {
    if (!config || !rota.legado) return;
    if (local.mun && !municipios) return; // espera a lista para pôr o nome do município no caminho
    const destino = rota.tela.cargo ? caminhoDe(local, cargo?.id) : '/';
    history.replaceState(null, '', destino);
    setRota({ tela: telaDe(destino) });
    // Só ao chegar a config/lista (ou outro link antigo): a tela é a mesma, muda só a URL.
  }, [config, municipios, rota.legado]);

  // ---------- ficha do candidato com URL própria (/candidato/<sq>-<nome>) ----------

  const abrirCandidato = useCallback((c: Candidato) => {
    const estado: EstadoFicha = { base: telaDe(location.pathname), dentro: true };
    history.pushState(estado, '', caminhoCandidato(c.sq, c.nomeUrna));
    setRota({ tela: rotaRef.current.tela, candidato: c.sq, temBase: true, dentro: true });
  }, [setRota]);

  const fecharCandidato = useCallback(() => {
    const r = rotaRef.current;
    if (!r.candidato) return;
    setRota({ tela: r.tela });
    // Aberta no app: volta à entrada anterior (a tela por baixo). Aberta direto pela URL: troca pela tela por baixo.
    if (r.dentro) history.back();
    else history.replaceState(null, '', caminhoDe(local, cargo?.id));
  }, [setRota, caminhoDe, local, cargo?.id]);

  return { caminhoDe, irPara, ir, irHome, abrirCandidato, fecharCandidato };
}
