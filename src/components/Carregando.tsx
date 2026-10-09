import { type ReactNode, useEffect, useState } from 'react';
import { useCarregandoGlobal } from '../api';

/**
 * Barra fina no topo da página enquanto houver requisições em andamento.
 * Só aparece se a espera passar de 150 ms (evita piscar em respostas do cache),
 * avança devagar até ~85% e completa quando tudo termina.
 */
export function BarraTopo() {
  const carregando = useCarregandoGlobal();
  const [fase, setFase] = useState<'oculta' | 'carregando' | 'concluindo'>('oculta');

  useEffect(() => {
    if (carregando) {
      const t = setTimeout(() => setFase('carregando'), 150);
      return () => clearTimeout(t);
    }
    setFase((f) => (f === 'carregando' ? 'concluindo' : f));
    const t = setTimeout(() => setFase('oculta'), 450);
    return () => clearTimeout(t);
  }, [carregando]);

  return <div className={`barra-topo ${fase}`} role="progressbar" aria-hidden={fase === 'oculta'} aria-label="Carregando" />;
}

/** Bloco cinza pulsante. `w`/`h` aceitam qualquer unidade CSS. */
export function Esq({ w = '100%', h = '1em', redondo = false, className = '' }: {
  w?: string; h?: string; redondo?: boolean; className?: string;
}) {
  return <span className={`esq ${redondo ? 'esq-redondo' : ''} ${className}`} style={{ width: w, height: h }} />;
}

/** Esqueleto do painel de resultados (mesma estrutura do PainelResultado); `titulo` já vem com o heading. */
export function EsqueletoPainel({ titulo, linhas = 6 }: { titulo?: ReactNode; linhas?: number }) {
  return (
    <section className="painel" aria-busy="true" aria-label="Carregando resultados">
      <header className="painel-topo">
        <div style={{ width: '100%' }}>
          {titulo ?? <Esq w="45%" h="2rem" />}
          <Esq w="60%" h="0.9rem" className="esq-espaco" />
        </div>
      </header>
      <div className="progresso">
        <div className="progresso-barra" />
        <Esq w="35%" h="0.9rem" />
      </div>
      <dl className="numeros">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i}>
            <dt><Esq w="60%" h="0.7rem" /></dt>
            <dd><Esq w="80%" h="1.1rem" /></dd>
          </div>
        ))}
      </dl>
      <Esq h="2.4rem" />
      <ol className="candidatos">
        {Array.from({ length: linhas }, (_, i) => (
          <li key={i} className="candidato">
            <span className="pos"><Esq w="1.2em" /></span>
            <Esq w="44px" h="44px" redondo className="foto" />
            <div className="cand-info">
              <Esq w={`${70 - i * 6}%`} h="1.1rem" />
              <Esq w="40%" h="0.75rem" className="esq-espaco" />
              <div className="barra" />
            </div>
            <div className="cand-votos">
              <Esq w="4.5rem" h="1.3rem" />
              <Esq w="5.5rem" h="0.75rem" className="esq-espaco" />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Esqueleto do mapa: mantém a proporção do SVG para a página não "pular". */
export function EsqueletoMapa() {
  return (
    <div className="esq-mapa" aria-busy="true" aria-label="Carregando mapa">
      <span className="esq-mapa-rotulo">Carregando mapa</span>
    </div>
  );
}

/** Página inteira enquanto a configuração inicial não chega. */
export function EsqueletoPagina() {
  return (
    <div className="app" aria-busy="true">
      <header className="topo">
        <div className="marca">
          <p className="marca-titulo">Apuração 2026</p>
          <div className="dataline"><Esq w="22rem" h="0.8rem" /></div>
        </div>
        <div className="busca"><Esq h="2.5rem" /></div>
      </header>
      <nav className="cargos">
        {[7, 8, 6, 10, 10, 11].map((w, i) => <Esq key={i} w={`${w}rem`} h="2rem" />)}
      </nav>
      <main className="grade">
        <section className="coluna-mapa">
          <Esq w="30%" h="1.4rem" />
          <EsqueletoMapa />
        </section>
        <aside className="coluna-painel"><EsqueletoPainel /></aside>
      </main>
    </div>
  );
}
