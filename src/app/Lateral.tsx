import type { ReactNode } from 'react';
import { UF_NOMES } from '../lib/util';
import { ListaRegioes } from '../ui/ListaRegioes';
import { ListaDuelos } from '../features/resultado/Duelo';
import { DiferencaUF } from '../features/mapa/DiferencaUF';
import { DestaquesUF } from '../features/mapa/DestaquesUF';
import type { DadosTela } from './useDadosTela';

/**
 * Coluna ao lado do mapa, conforme a tela (null = sem coluna, o mapa ocupa a largura):
 * - cargo estadual no Brasil: os duelos do 2º turno por UF, ou o líder em cada estado;
 * - Presidente no Brasil: a diferença entre os dois primeiros em cada UF;
 * - majoritário na UF: maiores eleitorados e disputas apertadas;
 * - município com zonas: a lista das zonas.
 */
export function lateralDe(d: DadosTela, onVerTodos: () => void): ReactNode {
  const { cargo, uf, local, precisaUf, segundoTurno, placar, mapaBr, mapaUf, mapaZonas, munAtual, munsUf } = d;

  if (precisaUf) {
    return segundoTurno ? (
      <section className={`bloco ${mapaBr.carregando && mapaBr.data ? 'atualizando' : ''}`}>
        <h2 className="titulo-bloco">Disputas no 2º turno</h2>
        <p className="muted pequeno">Nos demais estados o governador foi eleito no 1º turno. Clique numa disputa para ver o mapa por município.</p>
        <ListaDuelos ufs={cargo.ufs} dados={mapaBr.data} />
      </section>
    ) : (
      <section className="bloco">
        <ListaRegioes
          titulo="Líder em cada estado"
          itens={cargo.ufs.map((u) => ({ chave: u, nome: UF_NOMES[u] }))}
          dados={mapaBr.data}
          carregando={mapaBr.carregando}
          destino={(u) => ({ uf: u })}
        />
      </section>
    );
  }
  if (!uf && placar && cargo.escopo === 'br') {
    return <DiferencaUF a={placar.par[0]} b={placar.par[1]} cores={placar.cores} ufs={cargo.ufs} dados={mapaBr.data} />;
  }
  if (uf && uf !== 'zz' && !local.mun && cargo.tipo === 'majoritario') {
    return (
      <DestaquesUF
        dados={mapaUf.data}
        par={placar?.par ?? null}
        nome={d.nomeRegiao}
        uf={uf}
        total={munsUf.length}
        onVerTodos={onVerTodos}
      />
    );
  }
  if (uf && munAtual && munAtual.zonas.length > 0) {
    return (
      <section className="bloco">
        <ListaRegioes
          titulo={`Zonas eleitorais (${munAtual.zonas.length})`}
          itens={munAtual.zonas.map((z) => ({ chave: z, nome: `Zona ${Number(z)}` }))}
          dados={mapaZonas.data}
          carregando={mapaZonas.carregando}
          selecionado={local.zona}
          destino={(z) => ({ uf, mun: munAtual.cd, zona: z })}
        />
      </section>
    );
  }
  return null;
}
