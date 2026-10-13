import { useMemo, useSyncExternalStore } from 'react';
import { TOKENS, corPreenchimento, corTexto } from './util';

export type Tema = 'claro' | 'escuro';

const escuroNoSistema = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Tema em uso: o escolhido no botão (atributo data-tema no <html>) ou, sem escolha, o do sistema. */
function temaAtual(): Tema {
  const salvo = document.documentElement.dataset.tema;
  if (salvo === 'claro' || salvo === 'escuro') return salvo;
  return escuroNoSistema() ? 'escuro' : 'claro';
}

function assinar(aoMudar: () => void) {
  const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  mq?.addEventListener('change', aoMudar);
  const obs = new MutationObserver(aoMudar);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
  return () => { mq?.removeEventListener('change', aoMudar); obs.disconnect(); };
}

export function useTema(): Tema {
  return useSyncExternalStore(assinar, temaAtual, () => 'claro');
}

export function definirTema(novo: Tema) {
  document.documentElement.dataset.tema = novo;
  try {
    localStorage.setItem('tema', novo);
  } catch {
    // sem armazenamento (aba anônima etc.): a escolha vale só até recarregar
  }
}

/** Cores de partido ajustadas ao tema em uso (preenchimento e texto) e os tokens fixos do tema. */
export function useCores() {
  const tema = useTema();
  return useMemo(() => {
    const escuro = tema === 'escuro';
    return {
      escuro,
      ...TOKENS[tema],
      preench: (cor: string) => corPreenchimento(cor, escuro),
      texto: (cor: string) => corTexto(cor, escuro),
    };
  }, [tema]);
}
