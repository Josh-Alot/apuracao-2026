import { useMemo } from 'react';
import { RETENTAR_MS } from '../api/cliente';
import { ProximaAtualizacao } from '../apuracao/ProximaAtualizacao';
import type { ModoMapa } from '../lib/types';
import { UF_NOMES, corPartido, titulo } from '../lib/util';
import { LinkTela, useNavegacaoTela } from '../rota/Link';
import { ListaRegioes } from '../ui/ListaRegioes';
import { Mapa } from '../features/mapa/Mapa';
import { AvisoMapa } from '../features/mapa/AvisoMapa';
import { CartaoExterior } from '../features/mapa/CartaoExterior';
import { IndiceRegioes } from '../features/mapa/IndiceRegioes';
import type { DadosTela } from './useDadosTela';

/** Mapa da tela (ou a lista de cidades no exterior), com avisos e notas, e o índice de links das regiões abaixo. */
export function PainelMapa({ d, modo, onModo, indiceAberto, onIndice }: {
  d: DadosTela;
  modo: ModoMapa;
  onModo: (m: ModoMapa) => void;
  indiceAberto: boolean;
  onIndice: (aberto: boolean) => void;
}) {
  const { ir } = useNavegacaoTela();
  const { cargo, uf, local, apuracao, situacao, mapaBr, mapaUf, mapaZonas, mapaAtual, munAtual, munsUf, porCd, zonasNoMapa, precisaUf, segundoTurno } = d;
  const { encerrada, intervaloMapa, apuracaoAberta } = apuracao;

  const rotuloMapa = local.mun ? 'zona' : uf ? 'município' : 'UF';
  // Proporcional na UF: o mapa só tem o % apurado (milhares de candidatos).
  const modoMapa = uf && cargo.tipo === 'proporcional' ? 'apurado' : modo;

  /** Itens da lista de links abaixo do mapa (estados no Brasil, municípios na UF). */
  const indice = useMemo(() => {
    if (uf === 'zz') return null;
    if (!uf) return precisaUf ? null : cargo.ufs.filter((u) => u !== 'zz').map((u) => ({ chave: u, nome: UF_NOMES[u] }));
    return munsUf.map((m) => ({ chave: m.cd, nome: titulo(m.nome) }));
  }, [cargo, uf, precisaUf, munsUf]);

  const exterior = !uf && cargo.ufs.includes('zz') && (
    mapaBr.data?.zz?.lider ? (
      <CartaoExterior
        dados={mapaBr.data.zz}
        corLider={segundoTurno && cargo.escopo === 'br' ? d.corLider : (l) => corPartido(l.partido)}
      />
    ) : (
      <LinkTela className="cartao-exterior" para={{ uf: 'zz' }}>Ver votos no exterior →</LinkTela>
    )
  );

  return (
    <div className="coluna-mapa">
      <section className="painel-mapa">
        <header className="mapa-cabecalho">
          <h2 className="rotulo-secao">
            {uf === 'zz' ? 'Cidades no exterior' : `Mapa · ${modoMapa === 'apurado' ? '% apurado' : 'líder'} por ${rotuloMapa}`}
          </h2>
          {uf !== 'zz' && modoMapa === modo && (
            <div className="alternador" role="group" aria-label="Cor do mapa">
              <button className={modo === 'lider' ? 'ativo' : ''} aria-pressed={modo === 'lider'} onClick={() => onModo('lider')}>Líder</button>
              <button className={modo === 'apurado' ? 'ativo' : ''} aria-pressed={modo === 'apurado'} onClick={() => onModo('apurado')}>% apurado</button>
            </div>
          )}
        </header>

        <AvisoMapa
          erro={mapaAtual.erro}
          temDados={!!mapaAtual.data}
          regioes={situacao.regioesTotal}
          semDado={situacao.regioesTotal - situacao.regioesComDado}
          rotulo={uf === 'zz' ? 'cidades' : uf ? 'municípios' : 'UFs'}
          intervalo={encerrada ? RETENTAR_MS : intervaloMapa}
        />

        {uf === 'zz' ? (
          <ListaRegioes
            titulo="Cidades no exterior"
            itens={munsUf.map((m) => ({ chave: m.cd, nome: titulo(m.nome) }))}
            dados={mapaUf.data}
            carregando={mapaUf.carregando}
            selecionado={local.mun}
            destino={(cd) => ({ uf, mun: cd })}
          />
        ) : (
          <Mapa
            geo={d.geo}
            geoFalhou={!!d.erroGeo}
            chave={d.chaveRegiao}
            nome={d.nomeRegiao}
            dados={uf ? mapaUf.data : mapaBr.data}
            modo={modoMapa}
            selecionado={local.mun}
            focar={local.mun}
            rotuloRegiao={uf ? 'municípios' : 'UFs'}
            legendaPorPartido={!uf && cargo.escopo === 'uf'}
            segundoTurno={segundoTurno}
            corLider={segundoTurno && !(!uf && cargo.escopo === 'uf') ? d.corLider : undefined}
            rotulos={segundoTurno && !uf}
            onSelect={(k) => ir(uf ? { uf, mun: k } : { uf: k })}
            dica={(k) => (!uf
              ? 'Clique para abrir o estado →'
              : (porCd.get(k)?.zonas.length ?? 0) > 1 ? 'Clique para abrir as zonas →' : 'Clique para abrir o município →')}
            rodape={exterior}
            zonas={zonasNoMapa && munAtual ? {
              geo: zonasNoMapa,
              dados: mapaZonas.data,
              selecionada: local.zona,
              onSelect: (z) => ir({ uf, mun: munAtual.cd, zona: z }),
            } : undefined}
          />
        )}

        {zonasNoMapa && (
          <p className="muted pequeno nota-mapa">
            Limites das zonas eleitorais estimados pelos locais de votação (cada área fica com a zona do local mais
            próximo). O TSE não publica limites oficiais das zonas.
          </p>
        )}
        {uf && cargo.tipo === 'proporcional' && !local.mun && (
          <p className="muted pequeno nota-mapa">
            Para cargos proporcionais o mapa estadual mostra apenas o % apurado por município
            (há milhares de candidatos). Clique num município para ver os votos.
          </p>
        )}
        <p className="muted pequeno nota-mapa">
          <ProximaAtualizacao
            rotulo="Mapa atualizado"
            proxima={mapaAtual.proxima}
            intervalo={intervaloMapa}
            carregando={mapaAtual.carregando}
            inicio={apuracaoAberta ? null : cargo.encerramento}
            encerrada={encerrada}
          />
        </p>
      </section>

      {indice && indice.length > 0 && (
        <IndiceRegioes
          rotulo={uf ? `Todos os municípios de ${UF_NOMES[uf]}` : 'Todos os estados'}
          itens={indice}
          aberto={indiceAberto}
          onAlternar={onIndice}
          destino={(k) => (uf ? { uf, mun: k } : { uf: k })}
        />
      )}
    </div>
  );
}
