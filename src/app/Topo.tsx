import type { ItemBusca, Local } from '../lib/types';
import { Link, LinkTela } from '../rota/Link';
import { BarraBusca } from '../features/busca/BarraBusca';
import { BotaoTema } from '../ui/BotaoTema';
import { Logo } from '../ui/Logo';
import { cargoBase, localCargo, semSegundoTurno, turnosDe } from '../dominio/cargo';
import type { DadosTela } from './useDadosTela';

/** Topo: marca (e selos de demo/simulação/prévia), cargos do turno, busca e tema. */
export function Topo({ d, caminhoDe, irHome, onEscolherBusca }: {
  d: DadosTela;
  caminhoDe: (l: Local, cargoId?: string) => string;
  irHome: () => void;
  onEscolherBusca: (i: ItemBusca) => void;
}) {
  const { config, cargo, uf } = d;
  const variosTurnos = turnosDe(config).length > 1;
  return (
    <header className="topo">
      <div className="marca">
        {/* A marca não é o <h1>: o <h1> descreve a tela. */}
        <Link className="marca-titulo" href="/" onNavegar={irHome}><Logo />Apuração.org</Link>
        {config.demo && <span className="selo selo-demo" title="Votos sintéticos sobre os candidatos reais">Modo demo</span>}
        {cargo.simulado && (
          <span className="selo selo-demo" title="Votos do 2º turno de 2022 aplicados aos candidatos que foram ao 2º turno de 2026">
            Simulação
          </span>
        )}
        {config.flags.previa && (
          <a className="selo selo-demo" href="/api/preview?sair" title="Todas as flags ligadas só neste navegador. Clique para sair da prévia.">
            Prévia · sair
          </a>
        )}
      </div>
      <nav className="cargos" aria-label="Cargo">
        {config.cargos.filter((c) => c.turno === cargo.turno).map((c) => (
          <LinkTela
            key={c.id}
            para={localCargo(c, uf)}
            cargo={c.id}
            ufFora={semSegundoTurno(c, uf) ? uf : undefined}
            className={c.id === cargo.id ? 'ativo' : undefined}
            aria-current={c.id === cargo.id ? 'page' : undefined}
          >
            {variosTurnos ? cargoBase(c) : c.nome}
          </LinkTela>
        ))}
      </nav>
      <div className="topo-acoes">
        {config.flags.busca && (
          <BarraBusca cargos={config.cargos} href={(i) => caminhoDe(localBusca(i), i.cargoId)} onEscolher={onEscolherBusca} />
        )}
        <BotaoTema />
      </div>
    </header>
  );
}

/** Tela aberta por um item da busca: a UF da candidatura (Brasil para Presidente). */
export const localBusca = (i: ItemBusca): Local => (i.uf === 'br' ? {} : { uf: i.uf });
