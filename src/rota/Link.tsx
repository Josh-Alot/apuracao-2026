import { type AnchorHTMLAttributes, type MouseEvent, createContext, useContext, useEffect, useRef } from 'react';

/** Clique "simples" (botão principal, sem ctrl/cmd/shift/alt): os outros ficam com o navegador (nova aba/janela). */
export const cliqueSimples = (e: MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** Adianta os dados de um caminho interno (o App consulta o resultado da tela de destino). */
export const PrefetchContext = createContext<((href: string) => void) | null>(null);

/** Tempo com o ponteiro parado sobre o link antes de adiantar a consulta (passar o mouse por uma lista não dispara). */
const INTENCAO_MS = 120;

/**
 * Link interno: `<a href>` de verdade (o Google só segue links, não `onClick`) que, no clique simples,
 * navega sem recarregar a página. Ctrl/cmd/meio-clique abrem o caminho numa aba nova, como qualquer link.
 * Com o ponteiro sobre ele (ou o foco do teclado), os dados do destino já começam a ser consultados.
 */
export function Link({ onNavegar, onClick, onPointerEnter, onPointerLeave, onFocus, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  onNavegar: () => void;
}) {
  const prefetch = useContext(PrefetchContext);
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
