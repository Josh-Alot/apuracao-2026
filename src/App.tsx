import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { RETENTAR_MS, getJson, qs, urlAoVivo, urlMapa, urlResultado, useApi } from './api';
import type {
  Candidato, Cargo, Composicao, Config, DetalheCandidato, ItemBusca, Local, MapaDados, ModoMapa, Municipios, Resultado, Resumo, ResumoCandidato,
} from './types';
import { UF_NOMES, corPartido, fmt, fmtPct, titulo } from './util';
import { useCores } from './tema';
import { Mapa } from './components/Mapa';
import { PainelResultado } from './components/PainelResultado';
import { BarraBusca } from './components/BarraBusca';
import { ListaRegioes } from './components/ListaRegioes';
import { BarraTopo, EsqueletoPagina } from './components/Carregando';
import { ProximaAtualizacao } from './components/ProximaAtualizacao';
import { AvisoVotacao, faseVotacao, useAgora } from './components/AvisoVotacao';
import { BotaoTema } from './components/BotaoTema';
import { Hemiciclo } from './components/Hemiciclo';
import { ListaDuelos, coresFinalistas, corDoLider, finalistas } from './components/Duelo';
import { LinhaRotulo, Placar } from './components/Placar';
import { TickerUFs } from './components/TickerUFs';
import { DiferencaUF } from './components/DiferencaUF';
import { DestaquesUF } from './components/DestaquesUF';
import { Num } from './components/Num';
import { Link } from './components/Link';
import { Logo } from './components/Logo';
import { caminho, caminhoCandidato, cargoPorSlug, lerCaminho, slugCargo, tituloPagina } from './rotas.mjs';

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
  const [indiceAberto, setIndiceAberto] = useState(false);

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
  // 2º turno ainda sem votos: o placar mostra o 1º turno da mesma região como referência (do arquivo, já final).
  const resultado1t = useApi<Resultado>(
    segundoTurno && cargo?.primeiroTurno && !precisaUf && resultado.data?.votos.validos === 0
      ? urlResultado(cargo.primeiroTurno, local)
      : null,
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
  // Contorno estimado das zonas (só existe para municípios com mais de uma zona).
  const { data: geoZonas } = useApi<FeatureCollection & { mun: string }>(
    temMalha && munAtual && munAtual.zonas.length > 1 ? `/api/zonas?uf=${uf}&mun=${munAtual.cd}` : null,
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
    : aoVivo && tempoReal ? 'Ao vivo' : 'Atualização periódica';
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
          <p className="marca-titulo"><Logo />Apuração.org</p>
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
          local={tituloPainel}
          filtroInicial={filtroCand}
          candidatoAberto={rota.candidato}
          vencidas={vencidas}
          lateral={proximoPlantao}
          onAbrirCandidato={abrirCandidato}
          onFecharCandidato={fecharCandidato}
        />
      )}

      <footer className="rodape muted pequeno">
        Fonte: TSE (resultados.tse.jus.br) e IBGE (malhas). Projeto independente, sem vínculo com o TSE.
      </footer>
    </div>
  );
}

/** Caixa "Próximo plantão": o 2º turno já está na config e a votação ainda não começou. */
function ProximoPlantao({ cargo }: { cargo: Cargo }) {
  const [d, m, a] = cargo.data.split('/').map(Number);
  const semana = new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
  const hora = (iso: string | null) => (iso
    ? new Date(iso).toLocaleTimeString('pt-BR', { hour: 'numeric', timeZone: 'America/Sao_Paulo' }).replace(/:00$/, '').replace(/^0/, '') + 'h'
    : '');
  return (
    <section className="proximo-plantao">
      <span className="rotulo-secao">Próximo plantão</span>
      <strong>2º turno · {semana}, {cargo.data.slice(0, 5)}</strong>
      <p>
        Urnas abertas das {hora(cargo.abertura)} às {hora(cargo.encerramento)} (Brasília). Resultados ao vivo a partir
        das {hora(cargo.encerramento)}.
      </p>
    </section>
  );
}

/** Exterior no mapa do Brasil: não tem malha, então vira um cartão ao lado da legenda. */
function CartaoExterior({ dados, corLider, href, onAbrir }: {
  dados: Resumo; corLider: (l: ResumoCandidato) => string; href: string; onAbrir: () => void;
}) {
  const tema = useCores();
  const cands = [dados.lider, dados.segundo].filter((c): c is ResumoCandidato => !!c);
  return (
    <Link className="cartao-exterior" href={href} onNavegar={onAbrir} title="Ver votos por cidade no exterior">
      <strong>Exterior →</strong>
      <span className="cartao-exterior-cands">
        {cands.map((c) => (
          <span key={c.numero}>
            <i className="quadrado" style={{ background: tema.preench(corLider(c)) }} />
            {titulo(c.nome)}&nbsp;<b>{fmtPct(c.pct)}</b>
          </span>
        ))}
      </span>
      <span className="muted">{fmtPct(dados.pctApurado)} apurado</span>
    </Link>
  );
}

/**
 * Links para as regiões do mapa (fechado por padrão). O SVG do mapa não usa <a href> (arrastar um link inicia o
 * "arrastar e soltar" do navegador e o toque longo abre a prévia do link, o que atrapalharia o zoom/arraste);
 * sem esta lista, as páginas de UF e de município não teriam link rastreável.
 */
function IndiceRegioes({ rotulo, itens, aberto, onAlternar, href, onSelect }: {
  rotulo: string; itens: { chave: string; nome: string }[]; aberto: boolean; onAlternar: (aberto: boolean) => void;
  href: (k: string) => string; onSelect: (k: string) => void;
}) {
  return (
    <details className="indice-regioes" id="indice-regioes" open={aberto} onToggle={(e) => onAlternar(e.currentTarget.open)}>
      <summary>{rotulo} ({fmt(itens.length)})</summary>
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

function SeletorMunicipio({ rotulo, municipios, onEscolher }: {
  rotulo: string; municipios: { cd: string; nome: string }[]; onEscolher: (cd: string) => void;
}) {
  const [valor, setValor] = useState('');
  return (
    <label className="campo-rotulado seletor-municipio">
      <span>{rotulo}</span>
      <input
        list="lista-municipios"
        placeholder="ir para…"
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
    </label>
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
