/**
 * Ícone da marca: a urna (bloco de tinta com a fenda no topo) e três barras subindo, a contagem.
 * Desenhado em `currentColor` com os vazados na cor do papel, então acompanha o tema claro/escuro.
 * Mesmo desenho do `public/favicon.svg`. Decorativo: o nome "Apuração.org" vem ao lado, em texto.
 */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" fill="currentColor" />
      <g fill="var(--bg)">
        <rect x="7" y="7" width="18" height="3" />
        <rect x="7" y="19" width="4.5" height="6" />
        <rect x="13.75" y="15.5" width="4.5" height="9.5" />
        <rect x="20.5" y="12.5" width="4.5" height="12.5" />
      </g>
    </svg>
  );
}
