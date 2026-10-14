import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { Feature } from 'geojson';
import { RETENTAR_MS, urlAoVivo } from '../api/cliente';
import { VALE_PARADO_MS, consultas } from '../api/consultas';
import { useConsulta } from '../api/useConsulta';
import type {
  Candidato, Cargo, Composicao, ItemBusca, Local, ModoMapa,
} from '../lib/types';
import { UF_NOMES, corPartido, fmt, fmtPct, titulo } from '../lib/util';
import { Mapa } from '../features/mapa/Mapa';
import { PainelResultado } from '../features/resultado/PainelResultado';
import { BarraBusca } from '../features/busca/BarraBusca';
import { ListaRegioes } from '../ui/ListaRegioes';
import { BarraTopo, EsqueletoPagina } from '../ui/Carregando';
import { ProximaAtualizacao } from '../apuracao/ProximaAtualizacao';
import { AvisoVotacao, faseVotacao } from '../apuracao/AvisoVotacao';
import { BotaoTema } from '../ui/BotaoTema';
import { Hemiciclo } from '../features/composicao/Hemiciclo';
import { ListaDuelos, coresFinalistas, corDoLider, finalistas } from '../features/resultado/Duelo';
import { LinhaRotulo, Placar } from '../features/resultado/Placar';
import { TickerUFs } from '../features/mapa/TickerUFs';
import { DiferencaUF } from '../features/mapa/DiferencaUF';
import { DestaquesUF } from '../features/mapa/DestaquesUF';
import { Num } from '../ui/Num';
import { Link } from '../rota/Link';
import { Logo } from '../ui/Logo';
import { SeletorMunicipio } from '../ui/SeletorMunicipio';
import { ProximoPlantao } from '../apuracao/ProximoPlantao';
import { AvisoMapa } from '../features/mapa/AvisoMapa';
import { CartaoExterior } from '../features/mapa/CartaoExterior';
import { IndiceRegioes } from '../features/mapa/IndiceRegioes';
import { casaLegislativa } from '../features/composicao/casa';
import { FichaCandidato } from '../features/candidato/FichaCandidato';
import { cargoPorSlug, tituloPagina } from '../rotas.mjs';
import { useRota } from '../rota/rota';
import { useNavegacao } from '../rota/useNavegacao';
import { ATUALIZA_RESULTADO_MS, useFaseApuracao } from '../apuracao/useFaseApuracao';
import { useFichaPelaUrl } from '../features/candidato/useFichaPelaUrl';

/** Nome do cargo como no <title> (e no <title> que o servidor injeta): "Governador", "Presidente 2º turno". */
const nomeCargo = (c: Cargo) => {
  const base = c.nome.replace(/ \(\d+º turno\)$/, '');
  return c.turno === 2 ? `${base} 2º turno` : base;
};

export default function App() {
  const { rota, rotaRef, setRota } = useRota();
  const [modo, setModo] = useState<ModoMapa>('lider');
  const [auto, setAuto] = useState(true);
  const [filtroCand, setFiltroCand] = useState<string | undefined>();
  const [indiceAberto, setIndiceAberto] = useState(false);

  const { data: config, erro: erroConfig } = useConsulta(consultas.config());
  const tela = rota.tela;
  const cargo = config && tela.cargo
    ? config.cargos.find((c) => c.id === tela.cargo) ?? cargoPorSlug(config.cargos, tela.cargo) ?? config.cargos[0]
    : config?.cargos[0];
  const flags = config?.flags;

  // Ao trocar para um cargo que não existe na UF atual (ex.: Dep. Distrital fora do DF), volta ao Brasil.
  const uf = tela.uf && cargo && !cargo.ufs.includes(tela.uf) ? undefined : tela.uf;
  const local: Local = uf ? { uf, mun: tela.mun, zona: tela.mun ? tela.zona : undefined } : {};

  // Com o "ao vivo" desligado no servidor (kill switch), tudo passa a ser atualização periódica.
  const {
    agora, apuracaoAberta, encerrada, aoVivo, intervaloMapa, intervaloResultado, vale, completarMapa, completarResultado,
  } = useFaseApuracao(cargo, auto && !!flags?.aoVivo);

  const { data: municipios } = useConsulta(cargo ? consultas.municipios(cargo.eleicao, cargo.cargo) : null);

  const limparFiltro = useCallback(() => setFiltroCand(undefined), []);
  const { caminhoDe, irPara, ir, irHome, abrirCandidato, fecharCandidato } = useNavegacao({
    config, cargo, municipios, local, rota, rotaRef, setRota, aoSair: limparFiltro,
  });
  useFichaPelaUrl(config, rota, setRota);

  const temMalha = !!uf && uf !== 'zz';
  const { data: geo } = useConsulta(cargo ? consultas.geo(temMalha ? uf : 'br') : null);

  const atualizaMapa = { intervalo: intervaloMapa, incompleto: completarMapa };
  const mapaBr = useConsulta(cargo && !uf ? consultas.mapa(cargo.id, 'br', undefined, vale) : null, atualizaMapa);
  const mapaUf = useConsulta(cargo && uf ? consultas.mapa(cargo.id, uf, undefined, vale) : null, atualizaMapa);
  const mapaZonas = useConsulta(cargo && uf && local.mun ? consultas.mapa(cargo.id, uf, local.mun, vale) : null, atualizaMapa);

  // Cargos estaduais não têm resultado nacional: no nível Brasil mostramos o resumo por estado.
  const precisaUf = cargo?.escopo === 'uf' && !uf;
  const resultado = useConsulta(cargo && !precisaUf ? consultas.resultado(cargo.id, local, vale) : null, {
    intervalo: intervaloResultado,
    sse: aoVivo && cargo && !precisaUf ? urlAoVivo(cargo.id, local) : null,
    incompleto: completarResultado,
  });

  // 2º turno: os dois finalistas, com as cores usadas no placar e no mapa.
  const segundoTurno = cargo?.turno === 2;
  const par = segundoTurno ? finalistas(resultado.data) : null;
  const chavePar = par?.map((c) => `${c.numero}${c.partido}`).join() ?? '';
  const cores = useMemo(() => coresFinalistas(par), [chavePar]);
  const corLider = useMemo(() => corDoLider(cores), [cores]);
  // 2º turno ainda sem votos: o placar mostra o 1º turno da mesma região como referência (do arquivo, já final).
  const resultado1t = useConsulta(
    segundoTurno && cargo?.primeiroTurno && !precisaUf && resultado.data?.votos.validos === 0
      ? consultas.resultado(cargo.primeiroTurno, local, VALE_PARADO_MS)
      : null,
  );

  // Composição da casa legislativa: Senado sempre nacional; Dep. Federal da UF ou do Brasil; assembleias da UF.
  const casa = cargo && flags?.hemiciclo ? casaLegislativa(cargo.cargo, uf) : null;
  const composicao = useConsulta(cargo && casa ? consultas.composicao(cargo.id, casa.nacional ? undefined : uf, vale) : null, {
    intervalo: intervaloMapa,
    incompleto: encerrada ? (d: Composicao) => d.faltando > 0 : undefined,
  });

  // Fase da eleição (antes / votando / aguardando boletins / apurando) para o aviso do topo.
  const mapaAtual = uf ? mapaUf : mapaBr;
  // O mapa devolve null nas regiões cuja consulta ao TSE falhou: só contam as que vieram.
  const regioesComDado = Object.values(mapaAtual.data ?? {}).filter((x) => x != null);
  const regioesTotal = Object.keys(mapaAtual.data ?? {}).length;
  const pctApurado = resultado.data?.secoes.pct ?? Math.max(0, ...regioesComDado.map((x) => x.pctApurado ?? 0));
  const temDadoApuracao = !!(resultado.data || regioesComDado.length);
  // Sem nenhum dado e com erro na consulta: o TSE não respondeu (429, fora do ar), não é falta de boletim.
  const tseIndisponivel = !temDadoApuracao && !!(resultado.erro || mapaAtual.erro || Object.keys(mapaAtual.data ?? {}).length);
  // Sem dado e sem erro = ainda carregando (ex.: acabou de trocar de aba): sem faixa. "Urnas fechadas"
  // só quando o TSE de fato respondeu com 0% apurado.
  const carregandoApuracao = !temDadoApuracao && !tseIndisponivel;
  const fase = cargo
    ? faseVotacao(cargo, agora, temDadoApuracao ? pctApurado : null, tseIndisponivel, carregandoApuracao)
    : 'apurando';

  const munsUf = useMemo(() => (uf && municipios?.[uf]?.municipios) || [], [uf, municipios]);
  const porIbge = useMemo(() => new Map(munsUf.filter((m) => m.ibge).map((m) => [m.ibge!, m])), [munsUf]);
  const porCd = useMemo(() => new Map(munsUf.map((m) => [m.cd, m])), [munsUf]);
  const munAtual = local.mun ? porCd.get(local.mun) : undefined;
  // Contorno estimado das zonas (só existe para municípios com mais de uma zona).
  const { data: geoZonas } = useConsulta(
    temMalha && munAtual && munAtual.zonas.length > 1 ? consultas.zonas(uf, munAtual.cd) : null,
  );
  // Ao trocar de município o dado anterior fica até o novo chegar: só vale o do município aberto.
  const zonasNoMapa = munAtual && geoZonas?.mun === munAtual.cd ? geoZonas : null;

  const chave = useCallback(
    (f: Feature) => (temMalha ? porIbge.get(String(f.properties?.ibge))?.cd : f.properties?.uf),
    [temMalha, porIbge],
  );
  const nomeRegiao = useCallback(
    (k: string) => (temMalha ? titulo(porCd.get(k)?.nome ?? k) : UF_NOMES[k] ?? k),
    [temMalha, porCd],
  );

  const localBusca = (i: ItemBusca): Local => (i.uf === 'br' ? {} : { uf: i.uf });
  const escolherBusca = (i: ItemBusca) => {
    irPara(localBusca(i), i.cargoId);
    setFiltroCand(i.numero);
  };

  const turnos = [...new Set(config?.cargos.map((c) => c.turno))].sort();
  const cargosDoTurno = config?.cargos.filter((c) => c.turno === cargo?.turno) ?? [];
  /** Destino da troca de turno: mantém o cargo (e a UF) quando ele existe no outro turno. */
  const destinoTurno = (t: number): [Local, string] => {
    const doTurno = config!.cargos.filter((c) => c.turno === t);
    const destino = doTurno.find((c) => c.cargo === cargo?.cargo) ?? doTurno[0];
    return [uf && destino.ufs.includes(uf) ? { uf } : {}, destino.id];
  };
  const localCargo = (c: Cargo): Local => (uf && c.ufs.includes(uf) ? { uf } : {});

  // Título da aba a cada tela (o servidor injeta o mesmo no HTML inicial). Na home (/) fica o título geral.
  const candAberto = rota.candidato ? resultado.data?.candidatos.find((c) => c.sq === rota.candidato) : undefined;
  const tituloAba = !cargo
    ? null
    : rota.candidato
      ? candAberto ? tituloPagina({ candidato: titulo(candAberto.nomeUrna), partido: candAberto.partido }) : null
      : !tela.cargo
        ? tituloPagina({})
        : tituloPagina({
          cargoNome: nomeCargo(cargo), uf, ufNome: uf && UF_NOMES[uf],
          munNome: munAtual && titulo(munAtual.nome), zona: munAtual ? local.zona : undefined,
        });
  useEffect(() => { if (tituloAba) document.title = tituloAba; }, [tituloAba]);

  /** Itens da lista de links abaixo do mapa (estados no Brasil, municípios na UF). */
  const indice = useMemo(() => {
    if (!cargo || uf === 'zz') return null;
    if (!uf) return precisaUf ? null : cargo.ufs.filter((u) => u !== 'zz').map((u) => ({ chave: u, nome: UF_NOMES[u] }));
    return munsUf.map((m) => ({ chave: m.cd, nome: titulo(m.nome) }));
  }, [cargo, uf, precisaUf, munsUf]);

  if (erroConfig) return <div className="erro pad">Não foi possível carregar a configuração do TSE: {erroConfig}</div>;
  if (!config || !cargo) return <><BarraTopo /><EsqueletoPagina /></>;

  const tituloPainel = local.zona
    ? `Zona ${Number(local.zona)} · ${titulo(munAtual?.nome ?? '')}`
    : munAtual
      ? `${titulo(munAtual.nome)} (${uf!.toUpperCase()})`
      : uf
        ? UF_NOMES[uf]
        : 'Brasil';
  const cargoBase = cargo.nome.replace(/ \(\d+º turno\)$/, '');
  const r = resultado.data;

  // Placar: os dois da frente nos cargos majoritários (no 2º turno, os finalistas na ordem do número de urna).
  const parPlacar: [Candidato, Candidato] | null = cargo.tipo !== 'majoritario' || !r || r.candidatos.length < 2
    ? null
    : segundoTurno ? par : [r.candidatos[0], r.candidatos[1]];
  const coresPlacar: [string, string] | null = !parPlacar
    ? null
    : segundoTurno && cores
      ? [cores.get(parPlacar[0].numero)!, cores.get(parPlacar[1].numero)!]
      : [corPartido(parPlacar[0].partido), corPartido(parPlacar[1].partido)];
  // Regiões vencidas por candidato: UFs no Brasil, municípios na UF, zonas no município.
  const regioesPlacar = local.zona
    ? null
    : local.mun
      ? { dados: mapaZonas.data, rotulo: 'zonas' }
      : { dados: mapaAtual.data, rotulo: uf ? (uf === 'zz' ? 'cidades' : 'municípios') : 'UFs' };
  const vencidas = (numero: string) => {
    if (!regioesPlacar?.dados) return null;
    const n = Object.values(regioesPlacar.dados).filter((x) => x?.lider?.numero === numero).length;
    return n ? `${fmt(n)} ${regioesPlacar.rotulo}` : null;
  };

  const rotuloBrasil = (
    <LinhaRotulo
      direita={precisaUf
        ? (segundoTurno ? `${cargo.ufs.length} estados no 2º turno` : 'Escolha um estado')
        : r && `${parPlacar ? '% dos votos válidos' : 'Votos válidos'} · ${fmt(r.votos.validos)}`}
    >
      <h1>{cargoBase} · Brasil · {cargo.turno}º turno</h1>
    </LinhaRotulo>
  );

  const estado = fase === 'votando' ? 'Votação em andamento'
    : fase === 'antes' ? 'Votação ainda não começou'
    : fase === 'aguardando' ? 'Urnas fechadas'
    : fase === 'indisponivel' ? 'TSE indisponível'
    : encerrada ? 'Apuração encerrada'
    : aoVivo ? 'Ao vivo' : 'Atualização periódica';
  const fonteAtualizacao = precisaUf ? mapaBr : resultado;

  const cargo2t = config.cargos.find((c) => c.turno === 2);
  const proximoPlantao = cargo2t?.abertura && agora < Date.parse(cargo2t.abertura) ? <ProximoPlantao cargo={cargo2t} /> : null;

  const exterior = !uf && cargo.ufs.includes('zz') && (
    mapaBr.data?.zz?.lider ? (
      <CartaoExterior
        dados={mapaBr.data.zz}
        corLider={segundoTurno && cargo.escopo === 'br' ? corLider : (l) => corPartido(l.partido)}
        href={caminhoDe({ uf: 'zz' })}
        onAbrir={() => ir({ uf: 'zz' })}
      />
    ) : (
      <Link className="cartao-exterior" href={caminhoDe({ uf: 'zz' })} onNavegar={() => ir({ uf: 'zz' })}>
        Ver votos no exterior →
      </Link>
    )
  );

  const rotuloMapa = local.mun ? 'zona' : uf ? 'município' : 'UF';
  const modoMapa = uf && cargo.tipo === 'proporcional' ? 'apurado' : modo;

  let lateral: ReactNode = null;
  if (precisaUf) {
    lateral = segundoTurno ? (
      <section className={`bloco ${mapaBr.carregando && mapaBr.data ? 'atualizando' : ''}`}>
        <h2 className="titulo-bloco">Disputas no 2º turno</h2>
        <p className="muted pequeno">Nos demais estados o governador foi eleito no 1º turno. Clique numa disputa para ver o mapa por município.</p>
        <ListaDuelos ufs={cargo.ufs} dados={mapaBr.data} href={(u) => caminhoDe({ uf: u })} onSelect={(u) => ir({ uf: u })} />
      </section>
    ) : (
      <section className="bloco">
        <ListaRegioes
          titulo="Líder em cada estado"
          itens={cargo.ufs.map((u) => ({ chave: u, nome: UF_NOMES[u] }))}
          dados={mapaBr.data}
          carregando={mapaBr.carregando}
          href={(u) => caminhoDe({ uf: u })}
          onSelect={(u) => ir({ uf: u })}
        />
      </section>
    );
  } else if (!uf && parPlacar && coresPlacar && cargo.escopo === 'br') {
    lateral = (
      <DiferencaUF
        a={parPlacar[0]}
        b={parPlacar[1]}
        cores={coresPlacar}
        ufs={cargo.ufs}
        dados={mapaBr.data}
        href={(u) => caminhoDe({ uf: u })}
        onSelect={(u) => ir({ uf: u })}
      />
    );
  } else if (uf && uf !== 'zz' && !local.mun && cargo.tipo === 'majoritario') {
    lateral = (
      <DestaquesUF
        dados={mapaUf.data}
        par={parPlacar}
        nome={nomeRegiao}
        href={(cd) => caminhoDe({ uf, mun: cd })}
        onSelect={(cd) => ir({ uf, mun: cd })}
        total={munsUf.length}
        onVerTodos={() => {
          setIndiceAberto(true);
          requestAnimationFrame(() => document.getElementById('indice-regioes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }}
      />
    );
  } else if (munAtual && munAtual.zonas.length > 0) {
    lateral = (
      <section className="bloco">
        <ListaRegioes
          titulo={`Zonas eleitorais (${munAtual.zonas.length})`}
          itens={munAtual.zonas.map((z) => ({ chave: z, nome: `Zona ${Number(z)}` }))}
          dados={mapaZonas.data}
          carregando={mapaZonas.carregando}
          selecionado={local.zona}
          href={(z) => caminhoDe({ uf, mun: munAtual.cd, zona: z })}
          onSelect={(z) => ir({ uf, mun: munAtual.cd, zona: z })}
        />
      </section>
    );
  }

  return (
    <div className="app">
      <BarraTopo />
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
          {cargosDoTurno.map((c) => (
            <Link
              key={c.id}
              href={caminhoDe(localCargo(c), c.id)}
              className={c.id === cargo.id ? 'ativo' : undefined}
              aria-current={c.id === cargo.id ? 'page' : undefined}
              onNavegar={() => ir(localCargo(c), c.id)}
            >
              {turnos.length > 1 ? c.nome.replace(/ \(\d+º turno\)$/, '') : c.nome}
            </Link>
          ))}
        </nav>
        <div className="topo-acoes">
          {config.flags.busca && (
            <BarraBusca cargos={config.cargos} href={(i) => caminhoDe(localBusca(i), i.cargoId)} onEscolher={escolherBusca} />
          )}
          <BotaoTema />
        </div>
      </header>

      <AvisoVotacao cargo={cargo} fase={fase} agora={agora} />

      <div className="faixa-status">
        <div className="faixa-info">
          <span className="faixa-estado"><i aria-hidden="true" />{estado}</span>
          {r && (
            <span title={`${fmt(r.secoes.totalizadas)} de ${fmt(r.secoes.total)} seções totalizadas`}>
              Seções {fmt(r.secoes.totalizadas)} / {fmt(r.secoes.total)} · <b className="faixa-pct"><Num valor={r.secoes.pct} formatar={fmtPct} /></b>
            </span>
          )}
          {r?.atualizado && (
            <span title="Horário de Brasília da última publicação do TSE">
              Última totalização {r.atualizado.replace(/^(\d\d\/\d\d)\/\d{4}/, '$1')}
            </span>
          )}
          {r?.totalizado && <span>Totalização final</span>}
          <span className={fonteAtualizacao.carregando ? 'indicador-atualizando' : undefined}>
            <ProximaAtualizacao
              proxima={fonteAtualizacao.proxima}
              intervalo={precisaUf ? intervaloMapa : ATUALIZA_RESULTADO_MS}
              carregando={fonteAtualizacao.carregando}
              aoVivo={precisaUf ? null : resultado.aoVivo}
              inicio={apuracaoAberta ? null : cargo.encerramento}
              encerrada={encerrada}
              compacto
            />
          </span>
          {!encerrada && config.flags.aoVivo && (
            <label
              className="auto"
              title={auto
                ? 'Ao vivo: os resultados chegam assim que o TSE publica (verificação a cada 5 s). Desmarque para atualizar a cada 30 s.'
                : 'Atualização periódica: resultados a cada 30 s e mapa a cada 1 min. Marque para receber ao vivo.'}
            >
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> ao vivo
            </label>
          )}
        </div>
        {turnos.length > 1 && (
          <nav className="turnos" aria-label="Turno">
            {turnos.map((t) => {
              const c = config.cargos.find((x) => x.turno === t)!;
              const [l, id] = destinoTurno(t);
              return (
                <Link
                  key={t}
                  href={caminhoDe(l, id)}
                  className={t === cargo.turno ? 'ativo' : undefined}
                  aria-current={t === cargo.turno ? 'page' : undefined}
                  onNavegar={() => ir(l, id)}
                >
                  {t}º turno <span>{c.data.slice(0, 5)}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {cargo.simulado && (
        <div className="aviso-mapa aviso-simulacao" role="note">
          <strong>Simulação: o TSE ainda não divulgou o 2º turno</strong>
          <p>
            Os candidatos são os que foram ao 2º turno em 2026; os votos repetem, zona por zona, o 2º turno de
            2022 sobre o eleitorado de 2026. Os números serão trocados pelos oficiais quando o TSE publicar.
          </p>
        </div>
      )}

      {!uf && cargo.tipo === 'majoritario' && (
        <TickerUFs ufs={cargo.ufs} dados={mapaBr.data} href={(u) => caminhoDe({ uf: u })} onSelect={(u) => ir({ uf: u })} />
      )}

      {uf && (
        <div className="cabecalho-tela">
          <div className="trilha-linha">
            <nav className="trilha" aria-label="Navegação">
              <Link href={caminhoDe({})} onNavegar={() => ir({})}>Brasil</Link>
              <span aria-hidden="true">/</span>
              {munAtual
                ? <Link href={caminhoDe({ uf })} onNavegar={() => ir({ uf })}>{UF_NOMES[uf]}</Link>
                : <span aria-current="page">{UF_NOMES[uf]}</span>}
              {munAtual && (
                <>
                  <span aria-hidden="true">/</span>
                  {local.zona
                    ? <Link href={caminhoDe({ uf, mun: munAtual.cd })} onNavegar={() => ir({ uf, mun: munAtual.cd })}>{titulo(munAtual.nome)}</Link>
                    : <span aria-current="page">{titulo(munAtual.nome)}</span>}
                </>
              )}
              {local.zona && <><span aria-hidden="true">/</span><span aria-current="page">Zona {Number(local.zona)}</span></>}
            </nav>
            {munsUf.length > 0 && (
              <SeletorMunicipio
                rotulo={uf === 'zz' ? 'Cidade' : 'Município'}
                municipios={munsUf.map((m) => ({ cd: m.cd, nome: titulo(m.nome) }))}
                onEscolher={(cd) => ir({ uf, mun: cd })}
              />
            )}
          </div>
          <h1 className="titulo-tela">{tituloPainel}<span className="visualmente-oculto">: {nomeCargo(cargo)}</span></h1>
          <p className="subtitulo-tela">
            {cargoBase} · {cargo.turno}º turno
            {!local.mun && munsUf.length > 0 && ` · ${fmt(munsUf.length)} ${uf === 'zz' ? 'cidades' : 'municípios'}`}
            {local.mun && !local.zona && munAtual && munAtual.zonas.length > 1 && ` · ${munAtual.zonas.length} zonas`}
            {r && ` · ${fmt(r.eleitorado.total)} eleitores`}
          </p>
        </div>
      )}

      {parPlacar && coresPlacar && r ? (
        <Placar
          resultado={r}
          par={parPlacar}
          cores={coresPlacar}
          compacto={!!uf}
          regioes={regioesPlacar}
          exterior={!uf && cargo.ufs.includes('zz') ? mapaBr.data?.zz ?? null : undefined}
          primeiroTurno={resultado1t.data}
          maioria={cargo.cargo !== '5'}
          rotulo={uf ? undefined : rotuloBrasil}
          carregando={resultado.carregando}
          onAbrir={abrirCandidato}
        />
      ) : !uf && rotuloBrasil}

      <main className={`grade ${lateral ? '' : 'sem-lateral'}`}>
        <div className="coluna-mapa">
          <section className="painel-mapa">
            <header className="mapa-cabecalho">
              <h2 className="rotulo-secao">
                {uf === 'zz' ? 'Cidades no exterior' : `Mapa · ${modoMapa === 'apurado' ? '% apurado' : 'líder'} por ${rotuloMapa}`}
              </h2>
              {uf !== 'zz' && modoMapa === modo && (
                <div className="alternador" role="group" aria-label="Cor do mapa">
                  <button className={modo === 'lider' ? 'ativo' : ''} aria-pressed={modo === 'lider'} onClick={() => setModo('lider')}>Líder</button>
                  <button className={modo === 'apurado' ? 'ativo' : ''} aria-pressed={modo === 'apurado'} onClick={() => setModo('apurado')}>% apurado</button>
                </div>
              )}
            </header>

            <AvisoMapa
              erro={mapaAtual.erro}
              temDados={!!mapaAtual.data}
              regioes={regioesTotal}
              semDado={regioesTotal - regioesComDado.length}
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
                href={(cd) => caminhoDe({ uf, mun: cd })}
                onSelect={(cd) => ir({ uf, mun: cd })}
              />
            ) : (
              <Mapa
                geo={geo}
                chave={chave}
                nome={nomeRegiao}
                dados={uf ? mapaUf.data : mapaBr.data}
                modo={modoMapa}
                selecionado={local.mun}
                focar={local.mun}
                rotuloRegiao={uf ? 'municípios' : 'UFs'}
                legendaPorPartido={!uf && cargo.escopo === 'uf'}
                segundoTurno={segundoTurno}
                corLider={segundoTurno && !(!uf && cargo.escopo === 'uf') ? corLider : undefined}
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
              onAlternar={setIndiceAberto}
              href={(k) => caminhoDe(uf ? { uf, mun: k } : { uf: k })}
              onSelect={(k) => ir(uf ? { uf, mun: k } : { uf: k })}
            />
          )}
        </div>

        {lateral && <aside className="coluna-lateral">{lateral}</aside>}
      </main>

      {casa && (
        <Hemiciclo
          dados={composicao.data}
          erro={composicao.erro}
          carregando={composicao.carregando}
          titulo={casa.titulo}
          subtitulo={casa.subtitulo}
          maioria={casa.casaInteira && composicao.data ? Math.floor(composicao.data.vagas / 2) + 1 : undefined}
        />
      )}

      {precisaUf ? (
        proximoPlantao && <div className="grade-baixo"><span /><aside className="coluna-baixo">{proximoPlantao}</aside></div>
      ) : (
        <PainelResultado
          resultado={resultado.data}
          erro={resultado.erro}
          carregando={resultado.carregando}
          filtroInicial={filtroCand}
          lateral={proximoPlantao}
          onAbrirCandidato={abrirCandidato}
        />
      )}

      <FichaCandidato
        resultado={resultado.data}
        sq={rota.candidato}
        local={tituloPainel}
        vencidas={vencidas}
        onFechar={fecharCandidato}
      />

      <footer className="rodape muted pequeno">
        Fonte: TSE (resultados.tse.jus.br) e IBGE (malhas). Projeto independente, sem vínculo com o TSE.
      </footer>
    </div>
  );
}
