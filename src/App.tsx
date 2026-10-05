import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { RETENTAR_MS, urlAoVivo, urlMapa, urlResultado, useApi } from './api';
import type { Composicao, Config, ItemBusca, Local, MapaDados, ModoMapa, Municipios, Resultado } from './types';
import { UF_NOMES, titulo } from './util';
import { Mapa } from './components/Mapa';
import { PainelResultado } from './components/PainelResultado';
import { BarraBusca } from './components/BarraBusca';
import { ListaRegioes } from './components/ListaRegioes';
import { BarraTopo, EsqueletoPagina } from './components/Carregando';
import { ProximaAtualizacao } from './components/ProximaAtualizacao';
import { AvisoVotacao, faseVotacao, useAgora } from './components/AvisoVotacao';
import { BotaoTema } from './components/BotaoTema';
import { Hemiciclo } from './components/Hemiciclo';

/** "04/10/2026" → "Domingo, 4 de outubro de 2026" */
function dataPorExtenso(ddmmaaaa: string) {
  const [d, m, a] = ddmmaaaa.split('/').map(Number);
  const s = new Date(a, m - 1, d).toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Com "ao vivo" ligado, os resultados chegam por stream (o servidor verifica o TSE a cada 5 s)
// e o mapa é consultado com mais frequência. Desligado, tudo é atualizado periodicamente.
const ATUALIZA_RESULTADO_MS = 30_000;
const ATUALIZA_MAPA_MS = 60_000;
const ATUALIZA_MAPA_AO_VIVO_MS = 30_000;

// Apuração encerrada: o mapa só é consultado de novo enquanto houver região que ainda não chegou;
// o resultado, só se a consulta falhar.
const mapaIncompleto = (d: MapaDados) => Object.values(d).some((x) => x == null);
const nuncaIncompleto = () => false;

// ---------- rota no hash: #/<cargoId>/<uf>/<mun>/<zona> ----------

interface Rota extends Local { cargo?: string }

function lerHash(): Rota {
  const [cargo, uf, mun, zona] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { cargo, uf, mun, zona };
}

function escreverHash(r: Rota) {
  const partes = [r.cargo, r.uf, r.mun, r.zona].filter(Boolean);
  const novo = `#/${partes.join('/')}`;
  if (location.hash !== novo) location.hash = novo;
}

export default function App() {
  const [rota, setRota] = useState<Rota>(lerHash);
  const [modo, setModo] = useState<ModoMapa>('lider');
  const [auto, setAuto] = useState(true);
  const [filtroCand, setFiltroCand] = useState<string | undefined>();

  useEffect(() => {
    const on = () => setRota(lerHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  const { data: config, erro: erroConfig } = useApi<Config>('/api/config');
  const cargo = config?.cargos.find((c) => c.id === rota.cargo) ?? config?.cargos[0];
  const flags = config?.flags;
  // Com o "ao vivo" desligado no servidor (kill switch), tudo passa a ser atualização periódica.
  const aoVivo = auto && !!flags?.aoVivo;

  const ir = useCallback(
    (l: Local, cargoId = cargo?.id) => {
      setFiltroCand(undefined);
      escreverHash({ cargo: cargoId, ...l });
    },
    [cargo?.id],
  );

  // Ao trocar para um cargo que não existe na UF atual (ex.: Dep. Distrital fora do DF), volta ao Brasil.
  const uf = rota.uf && cargo && !cargo.ufs.includes(rota.uf) ? undefined : rota.uf;
  const local: Local = uf ? { uf, mun: rota.mun, zona: rota.mun ? rota.zona : undefined } : {};

  // Antes das 17h (fechamento das urnas) o TSE não divulga nada: carrega uma vez e não fica consultando.
  // O relógio anda a cada 15 s, então "ao vivo"/atualização periódica ligam sozinhos às 17h.
  const agora = useAgora(!!cargo?.encerramento);
  const apuracaoAberta = !cargo?.encerramento || agora >= Date.parse(cargo.encerramento);
  // Com 100% das seções totalizadas os números não mudam mais: sem "ao vivo" nem atualização periódica,
  // os dados vêm ao abrir a página e a cada navegação.
  const encerrada = !!cargo?.encerrada;
  const tempoReal = apuracaoAberta && !encerrada;
  const intervaloMapa = !tempoReal ? 0 : aoVivo ? ATUALIZA_MAPA_AO_VIVO_MS : ATUALIZA_MAPA_MS;
  const completarMapa = encerrada ? mapaIncompleto : undefined;

  const { data: municipios } = useApi<Municipios>(cargo ? `/api/municipios?cargo=${cargo.eleicao}-${cargo.cargo}` : null);
  const temMalha = !!uf && uf !== 'zz';
  const { data: geo } = useApi<FeatureCollection>(cargo ? `/api/geo/${temMalha ? uf : 'br'}` : null);

  const mapaBr = useApi<MapaDados>(cargo && !uf ? urlMapa(cargo.id, 'br') : null, intervaloMapa, null, completarMapa);
  const mapaUf = useApi<MapaDados>(cargo && uf ? urlMapa(cargo.id, uf) : null, intervaloMapa, null, completarMapa);
  const mapaZonas = useApi<MapaDados>(
    cargo && uf && local.mun ? urlMapa(cargo.id, uf, local.mun) : null,
    intervaloMapa,
    null,
    completarMapa,
  );

  // Cargos estaduais não têm resultado nacional: no nível Brasil mostramos o resumo por estado.
  const precisaUf = cargo?.escopo === 'uf' && !uf;
  const resultado = useApi<Resultado>(
    cargo && !precisaUf ? urlResultado(cargo.id, local) : null,
    !tempoReal || aoVivo ? 0 : ATUALIZA_RESULTADO_MS,
    tempoReal && aoVivo && cargo && !precisaUf ? urlAoVivo(cargo.id, local) : null,
    encerrada ? nuncaIncompleto : undefined,
  );

  // Composição da casa legislativa: Senado sempre nacional; Dep. Federal da UF ou do Brasil; assembleias da UF.
  const casa = cargo && flags?.hemiciclo ? casaLegislativa(cargo.cargo, uf) : null;
  const composicao = useApi<Composicao>(
    cargo && casa ? `/api/composicao?cargo=${cargo.id}${casa.nacional ? '' : `&uf=${uf}`}` : null,
    tempoReal ? intervaloMapa : 0,
    null,
    encerrada ? (d: Composicao) => d.faltando > 0 : undefined,
  );

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

  const chave = useCallback(
    (f: Feature) => (temMalha ? porIbge.get(String(f.properties?.ibge))?.cd : f.properties?.uf),
    [temMalha, porIbge],
  );
  const nomeRegiao = useCallback(
    (k: string) => (temMalha ? titulo(porCd.get(k)?.nome ?? k) : UF_NOMES[k] ?? k),
    [temMalha, porCd],
  );

  const escolherBusca = (i: ItemBusca) => {
    escreverHash({ cargo: i.cargoId, uf: i.uf === 'br' ? undefined : i.uf });
    setFiltroCand(i.numero);
  };

  if (erroConfig) return <div className="erro pad">Não foi possível carregar a configuração do TSE: {erroConfig}</div>;
  if (!config || !cargo) return <><BarraTopo /><EsqueletoPagina /></>;

  const tituloPainel = local.zona
    ? `Zona ${Number(local.zona)} · ${titulo(munAtual?.nome ?? '')}`
    : munAtual
      ? `${titulo(munAtual.nome)} (${uf!.toUpperCase()})`
      : uf
        ? UF_NOMES[uf]
        : 'Brasil';

  return (
    <div className="app">
      <BarraTopo />
      <header className="topo">
        <div className="marca">
          <h1>Apuração 2026</h1>
          <span className="muted pequeno">Dados oficiais do TSE · {cargo.turno}º turno em {cargo.data}</span>
          {config.demo && <span className="selo selo-demo" title="Votos sintéticos sobre os candidatos reais">MODO DEMO</span>}
          {config.flags.previa && (
            <a className="selo selo-demo" href="/api/preview?sair" title="Todas as flags ligadas só neste navegador. Clique para sair da prévia.">
              PRÉVIA · sair
            </a>
          )}
          <div className="dataline">
            <span>{dataPorExtenso(cargo.data)}</span>
            <span>Eleições Gerais · {cargo.turno}º turno</span>
            {fase === 'votando' ? <span className="ao-vivo">Votação em andamento</span>
              : fase === 'antes' ? <span>Votação ainda não começou</span>
              : encerrada ? <span>Apuração encerrada</span>
              : aoVivo ? <span className="ao-vivo">Ao vivo</span> : <span>Atualização periódica</span>}
            <span>Dados oficiais do TSE</span>
            <BotaoTema />
          </div>
        </div>
        {config.flags.busca && <BarraBusca cargos={config.cargos} onEscolher={escolherBusca} />}
      </header>

      <AvisoVotacao cargo={cargo} fase={fase} agora={agora} />

      <nav className="cargos" aria-label="Cargo">
        {config.cargos.map((c) => (
          <button
            key={c.id}
            className={c.id === cargo.id ? 'ativo' : ''}
            onClick={() => ir(uf && c.ufs.includes(uf) ? { uf } : {}, c.id)}
          >
            {c.nome}
          </button>
        ))}
      </nav>

      <main className="grade">
        <section className="coluna-mapa">
          <div className="barra-mapa">
            <nav className="trilha" aria-label="Navegação">
              <button onClick={() => ir({})}>Brasil</button>
              {uf && <><span>›</span><button onClick={() => ir({ uf })}>{UF_NOMES[uf]}</button></>}
              {munAtual && <><span>›</span><button onClick={() => ir({ uf, mun: munAtual.cd })}>{titulo(munAtual.nome)}</button></>}
              {local.zona && <><span>›</span><span>Zona {Number(local.zona)}</span></>}
            </nav>
            <div className="controles">
              {uf && munsUf.length > 0 && (
                <SeletorMunicipio
                  municipios={munsUf.map((m) => ({ cd: m.cd, nome: titulo(m.nome) }))}
                  onEscolher={(cd) => ir({ uf, mun: cd })}
                />
              )}
              <div className="alternador" role="group" aria-label="Cor do mapa">
                <button className={modo === 'lider' ? 'ativo' : ''} onClick={() => setModo('lider')}>Líder</button>
                <button className={modo === 'apurado' ? 'ativo' : ''} onClick={() => setModo('apurado')}>% apurado</button>
              </div>
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
          </div>

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
              onSelect={(cd) => ir({ uf, mun: cd })}
            />
          ) : (
            <Mapa
              geo={geo}
              chave={chave}
              nome={nomeRegiao}
              dados={uf ? mapaUf.data : mapaBr.data}
              modo={uf && cargo.tipo === 'proporcional' ? 'apurado' : modo}
              selecionado={local.mun}
              focar={local.mun}
              rotuloRegiao={uf ? 'municípios' : 'UFs'}
              legendaPorPartido={!uf && cargo.escopo === 'uf'}
              onSelect={(k) => ir(uf ? { uf, mun: k } : { uf: k })}
            />
          )}

          <p className="muted pequeno nota-mapa">
            <ProximaAtualizacao
              rotulo="Mapa atualizado"
              proxima={(uf ? mapaUf : mapaBr).proxima}
              intervalo={intervaloMapa}
              carregando={(uf ? mapaUf : mapaBr).carregando}
              inicio={apuracaoAberta ? null : cargo.encerramento}
              encerrada={encerrada}
            />
          </p>

          {!uf && cargo.ufs.includes('zz') && (
            <button className="botao-exterior" onClick={() => ir({ uf: 'zz' })}>
              Ver votos no exterior →
            </button>
          )}
          {uf && cargo.tipo === 'proporcional' && !local.mun && (
            <p className="muted pequeno">
              Para cargos proporcionais o mapa estadual mostra apenas o % apurado por município
              (há milhares de candidatos). Clique num município para ver os votos.
            </p>
          )}

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

          {munAtual && munAtual.zonas.length > 0 && (
            <ListaRegioes
              titulo={`Zonas eleitorais (${munAtual.zonas.length})`}
              itens={munAtual.zonas.map((z) => ({ chave: z, nome: `Zona ${Number(z)}` }))}
              dados={mapaZonas.data}
              carregando={mapaZonas.carregando}
              selecionado={local.zona}
              onSelect={(z) => ir({ uf, mun: munAtual.cd, zona: z })}
            />
          )}
        </section>

        <aside className="coluna-painel">
          {precisaUf ? (
            <section className="painel">
              <h2>{cargo.nome}: escolha um estado</h2>
              <p className="muted">Este cargo é disputado por UF. Clique no mapa ou na lista abaixo.</p>
              <ListaRegioes
                titulo="Líder em cada estado"
                itens={cargo.ufs.map((u) => ({ chave: u, nome: UF_NOMES[u] }))}
                dados={mapaBr.data}
                carregando={mapaBr.carregando}
                onSelect={(u) => ir({ uf: u })}
              />
            </section>
          ) : (
            <PainelResultado
              resultado={resultado.data}
              erro={resultado.erro}
              carregando={resultado.carregando}
              titulo={tituloPainel}
              filtroInicial={filtroCand}
              proxima={resultado.proxima}
              intervalo={ATUALIZA_RESULTADO_MS}
              aoVivo={resultado.aoVivo}
              inicioAtualizacao={apuracaoAberta ? null : cargo.encerramento}
              encerrada={encerrada}
            />
          )}
        </aside>
      </main>

      <footer className="rodape muted pequeno">
        Fonte: TSE (resultados.tse.jus.br) e IBGE (malhas). Projeto independente, sem vínculo com o TSE.
      </footer>
    </div>
  );
}

/** Casa legislativa do cargo na abrangência atual (null se o cargo não elege uma). */
interface Casa { nacional: boolean; casaInteira: boolean; titulo: string; subtitulo?: string }

function casaLegislativa(cargo: string, uf: string | undefined): Casa | null {
  const nomeUf = uf ? UF_NOMES[uf] : '';
  if (cargo === '5') {
    return {
      nacional: true, casaInteira: false, titulo: 'Senado Federal: eleitos em 2026',
      subtitulo: '2 das 3 cadeiras de cada UF (54 de 81); as outras 27 seguem até 2031',
    };
  }
  if (uf === 'zz') return null;
  if (cargo === '6') {
    return uf
      ? { nacional: false, casaInteira: false, titulo: `Câmara dos Deputados: ${nomeUf}`, subtitulo: 'Bancada do estado; a Câmara inteira aparece no nível Brasil' }
      : { nacional: true, casaInteira: true, titulo: 'Câmara dos Deputados' };
  }
  if (!uf) return null;
  if (cargo === '7') return { nacional: false, casaInteira: true, titulo: `Assembleia Legislativa: ${nomeUf}` };
  if (cargo === '8') return { nacional: false, casaInteira: true, titulo: 'Câmara Legislativa do Distrito Federal' };
  return null;
}

function SeletorMunicipio({ municipios, onEscolher }: { municipios: { cd: string; nome: string }[]; onEscolher: (cd: string) => void }) {
  const [valor, setValor] = useState('');
  return (
    <>
      <input
        className="seletor-municipio"
        list="lista-municipios"
        placeholder="Ir para município…"
        value={valor}
        onChange={(e) => {
          setValor(e.target.value);
          const m = municipios.find((x) => x.nome.toLowerCase() === e.target.value.toLowerCase());
          if (m) { onEscolher(m.cd); setValor(''); }
        }}
      />
      <datalist id="lista-municipios">
        {municipios.map((m) => <option key={m.cd} value={m.nome} />)}
      </datalist>
    </>
  );
}

/** Aviso acima do mapa: falha/timeout ao carregar, ou regiões que ainda não chegaram do TSE. */
function AvisoMapa({ erro, temDados, regioes, semDado, rotulo, intervalo }: {
  erro: string | null; temDados: boolean; regioes: number; semDado: number; rotulo: string; intervalo: number;
}) {
  const novaTentativa = intervalo
    ? `Nova tentativa em ${Math.round(intervalo / 1000)} s.`
    : 'Recarregue a página para tentar de novo.';
  if (erro) {
    return (
      <div className="aviso-mapa aviso-mapa-erro" role="status">
        <strong>Não foi possível {temDados ? 'atualizar' : 'carregar'} o mapa</strong>
        <p>{erro}. {novaTentativa}</p>
      </div>
    );
  }
  if (!semDado) return null;
  const chegaram = regioes - semDado;
  return (
    <div className="aviso-mapa" role="status">
      <strong>
        {chegaram === 0
          ? `Mapa carregando: os ${regioes} ${rotulo} ainda estão chegando do TSE`
          : `Mapa incompleto: ${chegaram} de ${regioes} ${rotulo}`}
      </strong>
      <div className="aviso-mapa-barra" aria-hidden="true">
        <span style={{ width: `${(100 * chegaram) / regioes}%` }} />
      </div>
      <p>
        Faltam {semDado} {rotulo}. O servidor consulta o TSE aos poucos para não ser bloqueado, e o mapa se
        completa a cada atualização — as regiões em branco ainda não chegaram.
      </p>
    </div>
  );
}
