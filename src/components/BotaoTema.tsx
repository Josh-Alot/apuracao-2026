import { useEffect, useState } from 'react';

type Tema = 'claro' | 'escuro';

const escuroNoSistema = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

function temaAtual(): Tema {
  const salvo = document.documentElement.dataset.tema;
  if (salvo === 'claro' || salvo === 'escuro') return salvo;
  return escuroNoSistema() ? 'escuro' : 'claro';
}

/** Alterna entre claro e escuro. Sem escolha salva, o tema segue o do sistema. */
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
    <button type="button" className="botao-tema" onClick={alternar} title="Alternar entre tema claro e escuro">
      {tema === 'escuro' ? '☀ Tema claro' : '☾ Tema escuro'}
    </button>
  );
}
