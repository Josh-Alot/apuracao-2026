import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { ItemBusca, ModoMapa } from '../lib/types';
import { fmt } from '../lib/util';
import { BarraTopo, EsqueletoPagina, EsqueletoPlacar } from '../ui/Carregando';
import { AvisoVotacao } from '../apuracao/AvisoVotacao';
import { ProximoPlantao } from '../apuracao/ProximoPlantao';
import { PainelResultado } from '../features/resultado/PainelResultado';
import { LinhaRotulo, Placar } from '../features/resultado/Placar';
import { TickerUFs } from '../features/mapa/TickerUFs';
import { FichaCandidato } from '../features/candidato/FichaCandidato';
import { useFichaPelaUrl } from '../features/candidato/useFichaPelaUrl';
import { type Navegacao, NavegacaoContext } from '../rota/Link';
import { useRota } from '../rota/rota';
import { useNavegacao } from '../rota/useNavegacao';
import { cargoBase } from '../dominio/cargo';
import { regioesVencidas, rotuloRegioesVencidas } from '../dominio/placar';
import { nomeDaRegiao, tituloDaAba } from '../dominio/titulo';
import { useDadosTela } from './useDadosTela';
import { usePrefetch } from './usePrefetch';
import { Topo, localBusca } from './Topo';
import { FaixaStatus } from './FaixaStatus';
import { CabecalhoTela } from './CabecalhoTela';
import { PainelMapa } from './PainelMapa';
import { lateralDe } from './Lateral';

// Abaixo do mapa e só nos cargos legislativos: baixado à parte.
const Hemiciclo = lazy(() => import('../features/composicao/Hemiciclo').then((m) => ({ default: m.Hemiciclo })));

/**
 * Composição da tela: lê a rota, os dados (useDadosTela) e a navegação, e distribui aos componentes. Estado da
 * interface que vale para a visita (modo do mapa, "ao vivo", filtro vindo da busca, índice aberto) fica aqui.
 */
export default function App() {
  const { rota, rotaRef, setRota } = useRota();
  const [modo, setModo] = useState<ModoMapa>('lider');
  const [auto, setAuto] = useState(true);
  const [filtroCand, setFiltroCand] = useState<string | undefined>();
  const [indiceAberto, setIndiceAberto] = useState(false);

  const d = useDadosTela(rota, auto);

  const limparFiltro = useCallback(() => setFiltroCand(undefined), []);
  const { caminhoDe, irPara, ir, irHome, abrirCandidato, fecharCandidato } = useNavegacao({
    config: d.config, cargo: d.cargo, municipios: d.municipios, local: d.local, rota, rotaRef, setRota, aoSair: limparFiltro,
  });
  useFichaPelaUrl(d.config, rota, setRota);
  const ufTela = d.local.uf;
  const irMunicipio = useCallback((cd: string) => ir({ uf: ufTela, mun: cd }), [ir, ufTela]);
  const prefetch = usePrefetch(d.config, d.apuracao.vale);
  const navegacao = useMemo<Navegacao>(() => ({ caminhoDe, ir, prefetch }), [caminhoDe, ir, prefetch]);

  const candAberto = d.pronta && rota.candidato ? d.resultado.data?.candidatos.find((c) => c.sq === rota.candidato) : undefined;
  const tituloAba = d.pronta
    ? tituloDaAba({
      cargo: d.cargo, telaTemCargo: !!rota.tela.cargo, local: d.local, munAtual: d.munAtual, ficha: rota.candidato, candidato: candAberto,
    })
    : null;
  useEffect(() => { if (tituloAba) document.title = tituloAba; }, [tituloAba]);

  if (d.erroConfig) return <div className="erro pad">Não foi possível carregar a configuração do TSE: {d.erroConfig}</div>;
  if (!d.pronta) return <><BarraTopo /><EsqueletoPagina /></>;

  const { config, cargo, uf, local, apuracao, precisaUf, segundoTurno, placar, resultado, mapaBr, casa, composicao } = d;
  const r = resultado.data;
  const nomeRegiao = nomeDaRegiao(local, d.munAtual);

  const escolherBusca = (i: ItemBusca) => {
    irPara(localBusca(i), i.cargoId);
    setFiltroCand(i.numero);
  };

  // Regiões vencidas por candidato no placar e na ficha: UFs no Brasil, municípios na UF, zonas no município.
  const rotuloVencidas = rotuloRegioesVencidas(local);
  const regioesPlacar = rotuloVencidas ? { dados: local.mun ? d.mapaZonas.data : d.mapaAtual.data, rotulo: rotuloVencidas } : null;
  const vencidas = (numero: string) => {
    const n = regioesPlacar?.dados ? regioesVencidas(regioesPlacar.dados, numero) : 0;
    return n ? `${fmt(n)} ${regioesPlacar!.rotulo}` : null;
  };

  const rotuloBrasil = (
    <LinhaRotulo
      direita={precisaUf
        ? (segundoTurno ? `${cargo.ufs.length} estados no 2º turno` : 'Escolha um estado')
        : r && `${placar ? '% dos votos válidos' : 'Votos válidos'} · ${fmt(r.votos.validos)}`}
    >
      <h1>{cargoBase(cargo)} · Brasil · {cargo.turno}º turno</h1>
    </LinhaRotulo>
  );

  const cargo2t = config.cargos.find((c) => c.turno === 2);
  const proximoPlantao = cargo2t?.abertura && apuracao.agora < Date.parse(cargo2t.abertura) ? <ProximoPlantao cargo={cargo2t} /> : null;

  const lateral = lateralDe(d, () => {
    setIndiceAberto(true);
    requestAnimationFrame(() => document.getElementById('indice-regioes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });

  return (
    <NavegacaoContext value={navegacao}>
      <div className="app">
        <BarraTopo />
        <Topo d={d} caminhoDe={caminhoDe} irHome={irHome} onEscolherBusca={escolherBusca} />

        <AvisoVotacao cargo={cargo} fase={d.fase} agora={apuracao.agora} />
        <FaixaStatus d={d} auto={auto} onAuto={setAuto} />

        {cargo.simulado && (
          <div className="aviso-mapa aviso-simulacao" role="note">
            <strong>Simulação: o TSE ainda não divulgou o 2º turno</strong>
            <p>
              Os candidatos são os que foram ao 2º turno em 2026; os votos repetem, zona por zona, o 2º turno de
              2022 sobre o eleitorado de 2026. Os números serão trocados pelos oficiais quando o TSE publicar.
            </p>
          </div>
        )}

        {!uf && cargo.tipo === 'majoritario' && <TickerUFs ufs={cargo.ufs} dados={mapaBr.data} />}

        {uf && <CabecalhoTela d={{ ...d, uf }} nomeRegiao={nomeRegiao} onEscolherMunicipio={irMunicipio} />}

        {placar && r ? (
          <Placar
            resultado={r}
            par={placar.par}
            cores={placar.cores}
            compacto={!!uf}
            regioes={regioesPlacar}
            exterior={!uf && cargo.ufs.includes('zz') ? mapaBr.data?.zz ?? null : undefined}
            primeiroTurno={d.resultado1t.data}
            maioria={cargo.cargo !== '5'}
            rotulo={uf ? undefined : rotuloBrasil}
            carregando={resultado.carregando}
            onAbrir={abrirCandidato}
          />
        ) : cargo.tipo === 'majoritario' && !precisaUf && !r && !resultado.erro ? (
          <EsqueletoPlacar compacto={!!uf} rotulo={uf ? undefined : rotuloBrasil} />
        ) : !uf && rotuloBrasil}

        <main className={`grade ${lateral ? '' : 'sem-lateral'}`}>
          <PainelMapa d={d} modo={modo} onModo={setModo} indiceAberto={indiceAberto} onIndice={setIndiceAberto} />
          {lateral && <aside className="coluna-lateral">{lateral}</aside>}
        </main>

        {casa && (
          <Suspense fallback={<section className="hemiciclo" aria-busy><div className="hemiciclo-topo"><h3>{casa.titulo}</h3></div></section>}>
            <Hemiciclo
              dados={composicao.data}
              erro={composicao.erro}
              carregando={composicao.carregando}
              titulo={casa.titulo}
              subtitulo={casa.subtitulo}
              maioria={casa.casaInteira && composicao.data ? Math.floor(composicao.data.vagas / 2) + 1 : undefined}
            />
          </Suspense>
        )}

        {precisaUf ? (
          proximoPlantao && <div className="grade-baixo"><span /><aside className="coluna-baixo">{proximoPlantao}</aside></div>
        ) : (
          <PainelResultado
            resultado={r}
            erro={resultado.erro}
            carregando={resultado.carregando}
            filtroInicial={filtroCand}
            lateral={proximoPlantao}
            onAbrirCandidato={abrirCandidato}
          />
        )}

        <FichaCandidato
          resultado={r}
          sq={rota.candidato}
          local={nomeRegiao}
          vencidas={vencidas}
          onFechar={fecharCandidato}
        />

        <footer className="rodape muted pequeno">
          Fonte: TSE (resultados.tse.jus.br) e IBGE (malhas). Projeto independente, sem vínculo com o TSE.
        </footer>
      </div>
    </NavegacaoContext>
  );
}
