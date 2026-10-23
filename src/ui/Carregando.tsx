import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
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

/**
 * Esqueleto do placar (majoritários, enquanto o resultado não chega), com as mesmas classes e alturas do Placar:
 * sem ele, o placar entra depois e empurra o mapa para baixo (o maior deslocamento de layout da página). As
 * barras têm a altura da linha (`1lh`) para o esqueleto ter a mesma altura do texto.
 */
export function EsqueletoPlacar({ compacto = false, rotulo }: { compacto?: boolean; rotulo?: ReactNode }) {
  return (
    <section className={`placar ${compacto ? 'placar-compacto' : ''}`} aria-busy="true" aria-label="Carregando o placar">
      {rotulo}
      <div className="placar-colunas">
        {[0, 1].map((i) => (
          <div key={i} className="placar-lado" style={{ '--cor': 'var(--borda)' } as CSSProperties}>
            <div className="placar-nome-linha"><span className="placar-nome"><Esq w="60%" h="1lh" /></span></div>
            <p className="placar-sub"><Esq w="40%" h="1lh" /></p>
            <div className="placar-numeros">
              <span className="placar-pct vazio">––,––<span className="placar-sinal">%</span></span>
              {!compacto && (
                <dl className="placar-dados">
                  {[0, 1, 2].map((j) => <div key={j}><dt><Esq w="4em" h="1lh" /></dt><dd><Esq w="6em" h="1lh" /></dd></div>)}
                </dl>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="placar-barra vazia" />
      <div className="placar-legenda"><span>&nbsp;</span></div>
    </section>
  );
}

/**
 * Esqueleto do mapa: mantém a proporção do SVG para a página não "pular". Com `falhou`, avisa que a malha não
 * veio (quem a pede tenta de novo sozinho) em vez de parecer que ainda está carregando.
 */
export function EsqueletoMapa({ falhou = false }: { falhou?: boolean }) {
  return falhou ? (
    <div className="esq-mapa falhou" role="status">
      <span className="esq-mapa-rotulo">Mapa indisponível · tentando de novo</span>
    </div>
  ) : (
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
      <EsqueletoPlacar />
      <main className="grade">
        <section className="painel-mapa">
          <Esq w="30%" h="0.9rem" />
          <EsqueletoMapa />
        </section>
      </main>
    </div>
  );
}
