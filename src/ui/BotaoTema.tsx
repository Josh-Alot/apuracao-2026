import { definirTema, useTema } from '../lib/tema';

/** Botão de ícone claro/escuro: sol no escuro (vai para a edição diurna), lua no claro. Sem escolha salva, segue o sistema. */
export function BotaoTema() {
  const tema = useTema();
  const rotulo = tema === 'escuro' ? 'Mudar para a edição diurna' : 'Mudar para a edição noturna';
  return (
    <button
      type="button"
      className="botao-icone botao-tema"
      onClick={() => definirTema(tema === 'escuro' ? 'claro' : 'escuro')}
      aria-label={rotulo}
      title={rotulo}
    >
      {tema === 'escuro' ? (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <path
            d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="square"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M10.5 1.5a6.5 6.5 0 1 0 4 11.2A5.5 5.5 0 0 1 10.5 1.5Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
