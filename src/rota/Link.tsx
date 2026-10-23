import { type AnchorHTMLAttributes, type MouseEvent, createContext, useContext, useEffect, useRef } from 'react';
import type { Local } from '../lib/types';

/** Clique "simples" (botão principal, sem ctrl/cmd/shift/alt): os outros ficam com o navegador (nova aba/janela). */
export const cliqueSimples = (e: MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * Navegação do funil para os links, fornecida pelo App (o único contexto do app: a navegação vale para a tela
 * inteira). `cargoId` omitido = o cargo da tela atual.
 */
export interface Navegacao {
  /** Caminho de uma tela, com o nome do município quando a lista já chegou. */
  caminhoDe: (l: Local, cargoId?: string) => string;
  /** Navega para uma tela (nova entrada no histórico). */
  ir: (l: Local, cargoId?: string) => void;
  /** Adianta os dados de um caminho interno (o App consulta o resultado da tela de destino). */
  prefetch: (href: string) => void;
}

export const NavegacaoContext = createContext<Navegacao | null>(null);

/** Navegação do contexto (para o que não é link, como as regiões do mapa SVG). */
export function useNavegacaoTela() {
  const nav = useContext(NavegacaoContext);
  if (!nav) throw new Error('LinkTela fora do NavegacaoContext');
  return nav;
}

/** Tempo com o ponteiro parado sobre o link antes de adiantar a consulta (passar o mouse por uma lista não dispara). */
export const INTENCAO_MS = 120;

type PropsA = AnchorHTMLAttributes<HTMLAnchorElement>;

/**
 * Link interno: `<a href>` de verdade (o Google só segue links, não `onClick`) que, no clique simples,
 * navega sem recarregar a página. Ctrl/cmd/meio-clique abrem o caminho numa aba nova, como qualquer link.
 * Com o ponteiro sobre ele (ou o foco do teclado), os dados do destino já começam a ser consultados.
 */
export function Link({ onNavegar, onClick, onPointerEnter, onPointerLeave, onFocus, ...props }: PropsA & {
  href: string;
  onNavegar: () => void;
}) {
  const prefetch = useContext(NavegacaoContext)?.prefetch;
  const espera = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(espera.current), []);
  return (
    <a
      {...props}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (!prefetch) return;
        clearTimeout(espera.current);
        espera.current = setTimeout(() => prefetch(props.href), INTENCAO_MS);
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        clearTimeout(espera.current);
      }}
      onFocus={(e) => {
        onFocus?.(e);
        prefetch?.(props.href);
      }}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !cliqueSimples(e)) return;
        e.preventDefault();
        onNavegar();
      }}
    />
  );
}

/** Link para uma tela do funil (`para`, no cargo `cargo` ou no da tela atual): caminho e navegação vêm do contexto. */
export function LinkTela({ para, cargo, ...props }: Omit<PropsA, 'href'> & { para: Local; cargo?: string }) {
  const nav = useNavegacaoTela();
  return <Link {...props} href={nav.caminhoDe(para, cargo)} onNavegar={() => nav.ir(para, cargo)} />;
}
