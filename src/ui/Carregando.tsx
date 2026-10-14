import { useEffect, useState } from 'react';
import { useCarregandoGlobal } from '../api/cliente';
import { Logo } from './Logo';

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

/** Bloco reto pulsante. `w`/`h` aceitam qualquer unidade CSS. */
export function Esq({ w = '100%', h = '1em', className = '' }: { w?: string; h?: string; className?: string }) {
  return <span className={`esq ${className}`} style={{ width: w, height: h }} />;
}

/** Esqueleto da tabela de candidatos e do comparecimento (mesma estrutura do PainelResultado). */
export function EsqueletoPainel({ linhas = 6 }: { linhas?: number }) {
  return (
    <div className="grade-baixo" aria-busy="true" aria-label="Carregando resultados">
      <section className="bloco bloco-candidatos">
        <header className="bloco-cabecalho titulo-bloco-linha">
          <h2 className="titulo-bloco">Todos os candidatos</h2>
        </header>
        <table className="tabela-candidatos">
          <tbody>
            {Array.from({ length: linhas }, (_, i) => (
              <tr key={i}>
                <td className="col-num"><Esq w="2em" /></td>
                <td className="col-nome"><Esq w={`${70 - i * 6}%`} h="1.1rem" /></td>
                <td className="col-partido"><Esq w="4em" /></td>
                <td className="col-votos"><Esq w="6em" /></td>
                <td className="col-pct"><Esq w="4em" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <aside className="coluna-baixo">
        <section className="bloco bloco-comparecimento">
          <h2 className="titulo-bloco">Comparecimento</h2>
          <dl className="numeros">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <dt><Esq w="60%" h="0.7rem" /></dt>
                <dd><Esq w="80%" h="1.4rem" /></dd>
              </div>
            ))}
          </dl>
        </section>
      </aside>
    </div>
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
        <a className="marca-titulo" href="/"><Logo />Apuração.org</a>
        <nav className="cargos">
          {[7, 8, 6, 10, 10, 11].map((w, i) => <Esq key={i} w={`${w}rem`} h="1rem" />)}
        </nav>
        <div className="busca"><Esq h="2.5rem" /></div>
      </header>
      <div className="faixa-status"><Esq w="22rem" h="0.8rem" /></div>
      <div className="placar"><Esq w="40%" h="6rem" /><Esq h="14px" className="esq-espaco" /></div>
      <main className="grade">
        <section className="painel-mapa">
          <Esq w="30%" h="0.9rem" />
          <EsqueletoMapa />
        </section>
      </main>
    </div>
  );
}
