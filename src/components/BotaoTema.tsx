import { useEffect, useState } from 'react';

type Tema = 'claro' | 'escuro';

const escuroNoSistema = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

function temaAtual(): Tema {
  const salvo = document.documentElement.dataset.tema;
  if (salvo === 'claro' || salvo === 'escuro') return salvo;
  return escuroNoSistema() ? 'escuro' : 'claro';
}

/** Switch claro/escuro. Sem escolha salva, o tema segue o do sistema. */
export function BotaoTema() {
  const [tema, setTema] = useState<Tema>(temaAtual);

  // Enquanto o leitor não escolher, acompanha a troca de tema do sistema.
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const aoMudar = () => setTema(temaAtual());
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  const alternar = () => {
    const novo: Tema = tema === 'escuro' ? 'claro' : 'escuro';
    document.documentElement.dataset.tema = novo;
    try {
      localStorage.setItem('tema', novo);
    } catch {
      // sem armazenamento (aba anônima etc.): a escolha vale só até recarregar
    }
    setTema(novo);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={tema === 'escuro'}
      aria-label="Tema escuro"
      className="switch-tema"
      onClick={alternar}
      title={tema === 'escuro' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
    >
      <span className="switch-tema-trilho" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="10" height="10">
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <path
            d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <svg viewBox="0 0 16 16" width="10" height="10">
          <path d="M10.5 1.5a6.5 6.5 0 1 0 4 11.2A5.5 5.5 0 0 1 10.5 1.5Z" fill="currentColor" />
        </svg>
        <span className="switch-tema-bolinha" />
      </span>
    </button>
  );
}
