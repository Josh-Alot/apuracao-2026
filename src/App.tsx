import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { RETENTAR_MS, getJson, qs, urlAoVivo, urlMapa, urlResultado, useApi } from './api';
import type {
  Candidato, Cargo, Composicao, Config, DetalheCandidato, ItemBusca, Local, MapaDados, ModoMapa, Municipios, Resultado, Resumo, ResumoCandidato,
} from './types';
import { UF_NOMES, fmt, fmtPct, titulo } from './util';
import { Mapa } from './components/Mapa';
import { PainelResultado } from './components/PainelResultado';
import { BarraBusca } from './components/BarraBusca';
import { ListaRegioes } from './components/ListaRegioes';
import { BarraTopo, EsqueletoPagina } from './components/Carregando';
import { ProximaAtualizacao } from './components/ProximaAtualizacao';
import { AvisoVotacao, faseVotacao, useAgora } from './components/AvisoVotacao';
import { BotaoTema } from './components/BotaoTema';
import { Hemiciclo } from './components/Hemiciclo';
import { Duelo, ListaDuelos, coresFinalistas, corDoLider, finalistas } from './components/Duelo';
import { Link } from './components/Link';
import { caminho, caminhoCandidato, cargoPorSlug, lerCaminho, slugCargo, tituloPagina } from './rotas.mjs';

/** "25/10/2026" → "25 de outubro" */
function diaMes(ddmmaaaa: string) {
  const [d, m, a] = ddmmaaaa.split('/').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

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

// ---------- rota no caminho da URL (formato em rotas.mjs, o mesmo do servidor) ----------

/** Tela do funil. `cargo` = slug da URL (ex. "governador"); num link antigo (#/6257-1/…), o id da config. */
interface Tela extends Local { cargo?: string }

/** Estado guardado no history junto de /candidato/<sq>: a tela por baixo da ficha e se ela foi aberta no app. */
interface EstadoFicha { base: Tela; dentro: boolean }

interface Rota {
  tela: Tela;
  /** Ficha aberta (sq do candidato). */
  candidato?: string;
  /** Tela por baixo da ficha já conhecida (veio do history); senão, sai da busca pelo nome da URL. */
  temBase?: boolean;
  /** A ficha foi aberta de dentro do app: fechar = voltar no histórico. */
  dentro?: boolean;
  /** Link antigo no hash: o caminho novo é escrito assim que a config chega. */
  legado?: boolean;
}

/** Tela de um caminho do funil (`{}` para a home, um caminho inválido ou o de uma ficha). */
function telaDe(pathname: string): Tela {
  const r = lerCaminho(pathname);
  return r && r.candidato === undefined ? r : {};
}

function lerRota(): Rota {
  // Links antigos: #/<cargoId>/<uf>/<mun>/<zona>
  const hash = /^#\/(.*)$/.exec(location.hash);
  if (hash) {
    const [cargo, uf, mun, zona] = hash[1].split('/').filter(Boolean);
    return { tela: { cargo, uf, mun, zona }, legado: true };
  }
  const r = lerCaminho(location.pathname);
  // Formato inválido (o servidor já respondeu 404): mostra a tela padrão.
  if (!r) return { tela: {} };
  if (r.candidato !== undefined) {
    const st = history.state as EstadoFicha | null;
    return st?.base
      ? { tela: st.base, candidato: r.candidato, temBase: true, dentro: st.dentro }
      : { tela: {}, candidato: r.candidato };
  }
  return { tela: r };
}

/** Nome do cargo como no <title> (e no <title> que o servidor injeta): "Governador", "Presidente 2º turno". */
const nomeCargo = (c: Cargo) => {
  const base = c.nome.replace(/ \(\d+º turno\)$/, '');
  return c.turno === 2 ? `${base} 2º turno` : base;
};

/** Tentativas da busca que acha a candidatura de uma ficha aberta direto pela URL (o índice pode estar incompleto). */
const BUSCA_FICHA_TENTATIVAS = 5;
const BUSCA_FICHA_ESPERA_MS = 4_000;

export default function App() {
  const [rota, setRotaEstado] = useState<Rota>(lerRota);
  // Cópia para os handlers não dependerem do render (ex.: fechar a ficha duas vezes antes do popstate).
  const rotaRef = useRef(rota);
  const setRota = useCallback((r: Rota) => { rotaRef.current = r; setRotaEstado(r); }, []);
  const [modo, setModo] = useState<ModoMapa>('lider');
  const [auto, setAuto] = useState(true);
  const [filtroCand, setFiltroCand] = useState<string | undefined>();

  useEffect(() => {
    const on = () => setRota(lerRota());
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, [setRota]);

  const { data: config, erro: erroConfig } = useApi<Config>('/api/config');
  const tela = rota.tela;
  const cargo = config && tela.cargo
    ? config.cargos.find((c) => c.id === tela.cargo) ?? cargoPorSlug(config.cargos, tela.cargo) ?? config.cargos[0]
    : config?.cargos[0];
  const flags = config?.flags;
  // Com o "ao vivo" desligado no servidor (kill switch), tudo passa a ser atualização periódica.
  const aoVivo = auto && !!flags?.aoVivo;

  // Ao trocar para um cargo que não existe na UF atual (ex.: Dep. Distrital fora do DF), volta ao Brasil.
  const uf = tela.uf && cargo && !cargo.ufs.includes(tela.uf) ? undefined : tela.uf;
  const local: Local = uf ? { uf, mun: tela.mun, zona: tela.mun ? tela.zona : undefined } : {};

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

  /** Caminho de uma tela (cargo = id da config), com o nome do município quando a lista já chegou. */
  const caminhoDe = useCallback(
    (l: Local, cargoId = cargo?.id) => {
      const c = config?.cargos.find((x) => x.id === cargoId);
      const munNome = l.uf && l.mun ? municipios?.[l.uf]?.municipios.find((m) => m.cd === l.mun)?.nome : undefined;
      return caminho({ cargo: c && slugCargo(c), uf: l.uf, mun: l.mun, munNome, zona: l.zona });
    },
    [config, cargo?.id, municipios],
  );

  /** Navega para uma tela (nova entrada no histórico); `ir` também limpa o filtro vindo da busca. */
  const irPara = useCallback(
    (l: Local, cargoId = cargo?.id) => {
      const destino = caminhoDe(l, cargoId);
      if (destino !== location.pathname || location.hash || rotaRef.current.candidato) history.pushState(null, '', destino);
      setRota({ tela: telaDe(destino) });
    },
    [caminhoDe, cargo?.id, setRota],
  );
  const ir = useCallback(
    (l: Local, cargoId = cargo?.id) => {
      setFiltroCand(undefined);
      irPara(l, cargoId);
    },
    [irPara, cargo?.id],
  );

  // Link antigo (#/6257-1/sp/…): troca pelo caminho novo sem recarregar a página.
  useEffect(() => {
    if (!config || !rota.legado) return;
    if (local.mun && !municipios) return; // espera a lista para pôr o nome do município no caminho
    const destino = tela.cargo ? caminhoDe(local, cargo?.id) : '/';
    history.replaceState(null, '', destino);
    setRota({ tela: telaDe(destino) });
    // Só ao chegar a config/lista (ou outro link antigo): a tela é a mesma, muda só a URL.
  }, [config, municipios, rota.legado]);

  // ---------- ficha do candidato com URL própria (/candidato/<sq>-<nome>) ----------

  const abrirCandidato = useCallback((c: Candidato) => {
    const estado: EstadoFicha = { base: telaDe(location.pathname), dentro: true };
    history.pushState(estado, '', caminhoCandidato(c.sq, c.nomeUrna));
    setRota({ tela: rotaRef.current.tela, candidato: c.sq, temBase: true, dentro: true });
  }, [setRota]);

  const fecharCandidato = useCallback(() => {
    const r = rotaRef.current;
    if (!r.candidato) return;
    setRota({ tela: r.tela });
    // Aberta no app: volta à entrada anterior (a tela por baixo). Aberta direto pela URL: troca pela tela por baixo.
    if (r.dentro) history.back();
    else history.replaceState(null, '', caminhoDe(local, cargo?.id));
  }, [setRota, caminhoDe, local, cargo?.id]);

  // Ficha aberta direto pela URL: falta saber a tela por baixo dela (cargo/UF da candidatura). Vem do perfil
  // (/api/candidato/:sq, campo `candidatura`, quando o servidor o envia) ou, sem ele, da busca pelo nome que vem no
  // caminho (a busca é bloqueada no robots.txt, então para o Google só vale o perfil).
  useEffect(() => {
    if (!config || !rota.candidato || rota.temBase) return;
    const sq = rota.candidato;
    const nome = /^\d+-(.+)$/.exec(location.pathname.split('/').pop() ?? '')?.[1].replace(/-/g, ' ');
    const ctrl = new AbortController();
    let espera: ReturnType<typeof setTimeout> | undefined;
    const achou = (cargoId: string, ufCand: string | null | undefined) => {
      const c = config.cargos.find((x) => x.id === cargoId);
      if (!c) return false;
      const base: Tela = { cargo: slugCargo(c), uf: ufCand && ufCand !== 'br' ? ufCand : undefined };
      history.replaceState({ base, dentro: false } satisfies EstadoFicha, '', location.pathname);
      setRota({ tela: base, candidato: sq, temBase: true, dentro: false });
      return true;
    };
    // Sem como achar a candidatura: fica a tela padrão, sem a ficha (a URL fica; o servidor já mostrou o resumo).
    const semFicha = () => setRota({ tela: {} });
    const pelaBusca = async (tentativa: number) => {
      if (!nome || !config.flags.busca) return semFicha();
      try {
        const r = await getJson<{ itens: ItemBusca[]; parcial: unknown }>(`/api/busca?${qs({ q: nome, limite: '200' })}`, ctrl.signal);
        // O mesmo sq pode estar nos dois turnos: fica o cargo que vem antes na config (o turno mais recente).
        const ordem = (i: ItemBusca) => config.cargos.findIndex((c) => c.id === i.cargoId);
        const item = r.itens.filter((i) => i.sq === sq && ordem(i) >= 0).sort((a, b) => ordem(a) - ordem(b))[0];
        if (item && achou(item.cargoId, item.uf)) return;
        if (r.parcial && tentativa < BUSCA_FICHA_TENTATIVAS) espera = setTimeout(() => pelaBusca(tentativa + 1), BUSCA_FICHA_ESPERA_MS);
        else semFicha();
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (tentativa < BUSCA_FICHA_TENTATIVAS) espera = setTimeout(() => pelaBusca(tentativa + 1), BUSCA_FICHA_ESPERA_MS);
        else semFicha();
      }
    };
    (async () => {
      try {
        const d = await getJson<DetalheCandidato>(`/api/candidato/${sq}`, ctrl.signal);
        if (d.candidatura && achou(d.candidatura.cargoId, d.candidatura.uf)) return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
      pelaBusca(1);
    })();
    return () => { ctrl.abort(); clearTimeout(espera); };
  }, [config, rota.candidato, rota.temBase, setRota]);

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

  // 2º turno: os dois finalistas, com as cores usadas no placar e no mapa.
  const segundoTurno = cargo?.turno === 2;
  const par = segundoTurno ? finalistas(resultado.data) : null;
  const chavePar = par?.map((c) => `${c.numero}${c.partido}`).join() ?? '';
  const cores = useMemo(() => coresFinalistas(par), [chavePar]);
  const corLider = useMemo(() => corDoLider(cores), [cores]);

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

  return (
    <div className="app">
      <BarraTopo />
      <header className="topo">
        <div className="marca">
          {/* A marca não é o <h1>: o <h1> descreve a tela (título do painel). */}
          <p className="marca-titulo">Apuração 2026</p>
          <span className="muted pequeno">Dados oficiais do TSE · {cargo.turno}º turno em {cargo.data}</span>
          {config.demo && <span className="selo selo-demo" title="Votos sintéticos sobre os candidatos reais">MODO DEMO</span>}
          {cargo.simulado && (
            <span className="selo selo-demo" title="Votos do 2º turno de 2022 aplicados aos candidatos que foram ao 2º turno de 2026">
              SIMULAÇÃO
            </span>
          )}
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
            <span>{cargo.simulado ? 'Simulação com os votos de 2022' : 'Dados oficiais do TSE'}</span>
            <BotaoTema />
          </div>
        </div>
        {config.flags.busca && (
          <BarraBusca cargos={config.cargos} href={(i) => caminhoDe(localBusca(i), i.cargoId)} onEscolher={escolherBusca} />
        )}
      </header>

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
                <strong>{t}º turno</strong>
                <span>{diaMes(c.data)}</span>
              </Link>
            );
          })}
        </nav>
      )}

      <AvisoVotacao cargo={cargo} fase={fase} agora={agora} />

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

      {cargo.simulado && (
        <div className="aviso-mapa aviso-simulacao" role="note">
          <strong>Simulação: o TSE ainda não divulgou o 2º turno</strong>
          <p>
            Os candidatos são os que foram ao 2º turno em 2026; os votos repetem, zona por zona, o 2º turno de
            2022 sobre o eleitorado de 2026. Os números serão trocados pelos oficiais quando o TSE publicar.
          </p>
        </div>
      )}

      {segundoTurno && par && cores && resultado.data && (
        <Duelo
          resultado={resultado.data}
          cores={cores}
          local={tituloPainel}
          carregando={resultado.carregando}
          regioes={local.mun ? null : { dados: mapaAtual.data, rotulo: uf ? (uf === 'zz' ? 'cidades' : 'municípios') : 'UFs' }}
        />
      )}

      <main className="grade">
        <section className="coluna-mapa">
          <div className="barra-mapa">
            <nav className="trilha" aria-label="Navegação">
              <Link href={caminhoDe({})} onNavegar={() => ir({})}>Brasil</Link>
              {uf && <><span>›</span><Link href={caminhoDe({ uf })} onNavegar={() => ir({ uf })}>{UF_NOMES[uf]}</Link></>}
              {munAtual && (
                <>
                  <span>›</span>
                  <Link href={caminhoDe({ uf, mun: munAtual.cd })} onNavegar={() => ir({ uf, mun: munAtual.cd })}>{titulo(munAtual.nome)}</Link>
                </>
              )}
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
              href={(cd) => caminhoDe({ uf, mun: cd })}
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
              segundoTurno={segundoTurno}
              corLider={segundoTurno && !(!uf && cargo.escopo === 'uf') ? corLider : undefined}
              rotulos={segundoTurno && !uf}
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

          {indice && indice.length > 0 && (
            <IndiceRegioes
              rotulo={uf ? `Todos os municípios de ${UF_NOMES[uf]}` : 'Todos os estados'}
              itens={indice}
              href={(k) => caminhoDe(uf ? { uf, mun: k } : { uf: k })}
              onSelect={(k) => ir(uf ? { uf, mun: k } : { uf: k })}
            />
          )}

          {!uf && cargo.ufs.includes('zz') && (
            segundoTurno && mapaBr.data?.zz?.lider ? (
              <CartaoExterior dados={mapaBr.data.zz} corLider={corLider} href={caminhoDe({ uf: 'zz' })} onAbrir={() => ir({ uf: 'zz' })} />
            ) : (
              <Link className="botao-exterior" href={caminhoDe({ uf: 'zz' })} onNavegar={() => ir({ uf: 'zz' })}>
                Ver votos no exterior →
              </Link>
            )
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
              href={(z) => caminhoDe({ uf, mun: munAtual.cd, zona: z })}
              onSelect={(z) => ir({ uf, mun: munAtual.cd, zona: z })}
            />
          )}
        </section>

        <aside className="coluna-painel">
          {precisaUf ? (
            segundoTurno ? (
              <section className={`painel ${mapaBr.carregando && mapaBr.data ? 'atualizando' : ''}`}>
                <h1>{cargo.nome.replace(/ \(\d+º turno\)$/, '')}: {cargo.ufs.length} estados no 2º turno</h1>
                <p className="muted">Nos demais estados o governador foi eleito no 1º turno. Clique numa disputa para ver o mapa por município.</p>
                <ListaDuelos ufs={cargo.ufs} dados={mapaBr.data} href={(u) => caminhoDe({ uf: u })} onSelect={(u) => ir({ uf: u })} />
              </section>
            ) : (
              <section className="painel">
                <h1>{cargo.nome}: escolha um estado</h1>
                <p className="muted">Este cargo é disputado por UF. Clique no mapa ou na lista abaixo.</p>
                <ListaRegioes
                  titulo="Líder em cada estado"
                  itens={cargo.ufs.map((u) => ({ chave: u, nome: UF_NOMES[u] }))}
                  dados={mapaBr.data}
                  carregando={mapaBr.carregando}
                  href={(u) => caminhoDe({ uf: u })}
                  onSelect={(u) => ir({ uf: u })}
                />
              </section>
            )
          ) : (
            <PainelResultado
              resultado={resultado.data}
              erro={resultado.erro}
              carregando={resultado.carregando}
              titulo={tituloPainel}
              cargoNome={nomeCargo(cargo)}
              filtroInicial={filtroCand}
              proxima={resultado.proxima}
              intervalo={ATUALIZA_RESULTADO_MS}
              aoVivo={resultado.aoVivo}
              inicioAtualizacao={apuracaoAberta ? null : cargo.encerramento}
              encerrada={encerrada}
              candidatoAberto={rota.candidato}
              onAbrirCandidato={abrirCandidato}
              onFecharCandidato={fecharCandidato}
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

/** Exterior no mapa do Brasil (2º turno): não tem malha, então vira um cartão ao lado da legenda. */
function CartaoExterior({ dados, corLider, href, onAbrir }: {
  dados: Resumo; corLider: (l: ResumoCandidato) => string; href: string; onAbrir: () => void;
}) {
  const cands = [dados.lider, dados.segundo].filter((c): c is ResumoCandidato => !!c);
  return (
    <Link className="cartao-exterior" href={href} onNavegar={onAbrir} title="Ver votos por cidade no exterior">
      <strong>Exterior</strong>
      <span className="muted pequeno">{fmt(cands.reduce((t, c) => t + c.votos, 0))} votos válidos</span>
      <span className="cartao-exterior-cands">
        {cands.map((c) => (
          <span key={c.numero}>
            <span className="bolinha" style={{ background: corLider(c) }} />
            {titulo(c.nome)}&nbsp;<b>{fmtPct(c.pct)}</b>
          </span>
        ))}
      </span>
    </Link>
  );
}

/**
 * Links para as regiões do mapa (fechado por padrão). O SVG do mapa não usa <a href> (arrastar um link inicia o
 * "arrastar e soltar" do navegador e o toque longo abre a prévia do link, o que atrapalharia o zoom/arraste);
 * sem esta lista, as páginas de UF e de município não teriam link rastreável.
 */
function IndiceRegioes({ rotulo, itens, href, onSelect }: {
  rotulo: string; itens: { chave: string; nome: string }[]; href: (k: string) => string; onSelect: (k: string) => void;
}) {
  return (
    <details className="indice-regioes">
      <summary className="muted pequeno">{rotulo} ({fmt(itens.length)})</summary>
      <ul>
        {itens.map((i) => (
          <li key={i.chave}><Link href={href(i.chave)} onNavegar={() => onSelect(i.chave)}>{i.nome}</Link></li>
        ))}
      </ul>
    </details>
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
