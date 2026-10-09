import type { AnchorHTMLAttributes, MouseEvent } from 'react';

/** Clique "simples" (botão principal, sem ctrl/cmd/shift/alt): os outros ficam com o navegador (nova aba/janela). */
export const cliqueSimples = (e: MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * Link interno: `<a href>` de verdade (o Google só segue links, não `onClick`) que, no clique simples,
 * navega sem recarregar a página. Ctrl/cmd/meio-clique abrem o caminho numa aba nova, como qualquer link.
 */
export function Link({ onNavegar, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  onNavegar: () => void;
}) {
  return (
    <a
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !cliqueSimples(e)) return;
        e.preventDefault();
        onNavegar();
      }}
    />
  );
}
