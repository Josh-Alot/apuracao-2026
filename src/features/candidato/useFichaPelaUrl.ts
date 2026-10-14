import { useEffect } from 'react';
import { getJson, qs } from '../../api/cliente';
import type { Config, DetalheCandidato, ItemBusca } from '../../lib/types';
import type { EstadoFicha, Rota, Tela } from '../../rota/rota';
import { slugCargo } from '../../rotas.mjs';

/** Tentativas da busca que acha a candidatura de uma ficha aberta direto pela URL (o índice pode estar incompleto). */
const BUSCA_FICHA_TENTATIVAS = 5;
const BUSCA_FICHA_ESPERA_MS = 4_000;

/**
 * Ficha aberta direto pela URL: falta saber a tela por baixo dela (cargo/UF da candidatura). Vem do perfil
 * (/api/candidato/:sq, campo `candidatura`, quando o servidor o envia) ou, sem ele, da busca pelo nome que vem no
 * caminho (a busca é bloqueada no robots.txt, então para o Google só vale o perfil).
 */
export function useFichaPelaUrl(config: Config | null, rota: Rota, setRota: (r: Rota) => void) {
  useEffect(() => {
    if (!config || !rota.candidato || rota.temBase) return;
    const sq = rota.candidato;
    const nome = /^\d+-(.+)$/.exec(location.pathname.split('/').pop() ?? '')?.[1].replace(/-/g, ' ');
    const ctrl = new AbortController();
    let espera: ReturnType<typeof setTimeout> | undefined;
    const achou = (cargoId: string, ufCand: string | null | undefined) => {
      const c = config.cargos.find((x) => x.id === cargoId);
      if (!c) return false;
      const base: Tela = { cargo: slugCargo(c), uf: ufCand && ufCand !== 'br' ? ufCand : undefined };
      history.replaceState({ base, dentro: false } satisfies EstadoFicha, '', location.pathname);
      setRota({ tela: base, candidato: sq, temBase: true, dentro: false });
      return true;
    };
    // Sem como achar a candidatura: fica a tela padrão, sem a ficha (a URL fica; o servidor já mostrou o resumo).
    const semFicha = () => setRota({ tela: {} });
    const pelaBusca = async (tentativa: number) => {
      if (!nome || !config.flags.busca) return semFicha();
      try {
        const r = await getJson<{ itens: ItemBusca[]; parcial: unknown }>(`/api/busca?${qs({ q: nome, limite: '200' })}`, ctrl.signal);
        // O mesmo sq pode estar nos dois turnos: fica o cargo que vem antes na config (o turno mais recente).
        const ordem = (i: ItemBusca) => config.cargos.findIndex((c) => c.id === i.cargoId);
        const item = r.itens.filter((i) => i.sq === sq && ordem(i) >= 0).sort((a, b) => ordem(a) - ordem(b))[0];
        if (item && achou(item.cargoId, item.uf)) return;
        if (r.parcial && tentativa < BUSCA_FICHA_TENTATIVAS) espera = setTimeout(() => pelaBusca(tentativa + 1), BUSCA_FICHA_ESPERA_MS);
        else semFicha();
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (tentativa < BUSCA_FICHA_TENTATIVAS) espera = setTimeout(() => pelaBusca(tentativa + 1), BUSCA_FICHA_ESPERA_MS);
        else semFicha();
      }
    };
    (async () => {
      try {
        const d = await getJson<DetalheCandidato>(`/api/candidato/${sq}`, ctrl.signal);
        if (d.candidatura && achou(d.candidatura.cargoId, d.candidatura.uf)) return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
      pelaBusca(1);
    })();
    return () => { ctrl.abort(); clearTimeout(espera); };
  }, [config, rota.candidato, rota.temBase, setRota]);
}
