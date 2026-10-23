import { useMemo } from 'react';
import type { Feature } from 'geojson';
import { urlAoVivo } from '../api/cliente';
import { VALE_PARADO_MS, consultas } from '../api/consultas';
import { useConsulta } from '../api/useConsulta';
import { useFaseApuracao } from '../apuracao/useFaseApuracao';
import { casaLegislativa } from '../features/composicao/casa';
import type { Composicao, Local } from '../lib/types';
import { UF_NOMES, titulo } from '../lib/util';
import { resolverTela } from '../rota/resolver';
import type { Rota } from '../rota/rota';
import { coresFinalistas, corDoLider, finalistas } from '../dominio/duelo';
import { faseVotacao, situacaoApuracao } from '../dominio/fase';
import { placarDe } from '../dominio/placar';

/** A malha que chegou está completa; com o `incompleto`, o useConsulta só repete a consulta quando ela falha. */
const malhaNuncaIncompleta = () => false;

/**
 * Tudo o que a tela mostra, a partir da rota: cargo, UF e local resolvidos, a fase da apuração e o ritmo de
 * atualização, todas as consultas (config, municípios, malhas, mapas, resultado, composição) e o que se deriva
 * delas (município aberto, placar, cores do 2º turno, fase do aviso). Os componentes recebem daqui por props.
 * `pronta: false` enquanto a config não chega (ou falhou).
 */
export function useDadosTela(rota: Rota, aoVivoLigado: boolean) {
  const { data: config, erro: erroConfig } = useConsulta(consultas.config());
  const { cargo, uf, local } = config ? resolverTela(config, rota.tela) : { cargo: undefined, uf: undefined, local: {} as Local };
  const flags = config?.flags;

  // Com o "ao vivo" desligado no servidor (kill switch), tudo passa a ser atualização periódica.
  const apuracao = useFaseApuracao(cargo, aoVivoLigado && !!flags?.aoVivo);
  const { vale, intervaloMapa, intervaloResultado, completarMapa, completarResultado, encerrada } = apuracao;

  const { data: municipios } = useConsulta(cargo ? consultas.municipios(cargo.eleicao, cargo.cargo) : null);

  const temMalha = !!uf && uf !== 'zz';
  // A malha vale o dia todo, mas se falhar (servidor reiniciando, IBGE fora) repete a cada RETENTAR_MS em vez de
  // deixar o mapa no esqueleto até o F5.
  const { data: geo, erro: erroGeo } = useConsulta(cargo ? consultas.geo(temMalha ? uf : 'br') : null, { incompleto: malhaNuncaIncompleta });

  const atualizaMapa = { intervalo: intervaloMapa, incompleto: completarMapa };
  const mapaBr = useConsulta(cargo && !uf ? consultas.mapa(cargo.id, 'br', undefined, vale) : null, atualizaMapa);
  const mapaUf = useConsulta(cargo && uf ? consultas.mapa(cargo.id, uf, undefined, vale) : null, atualizaMapa);
  const mapaZonas = useConsulta(cargo && uf && local.mun ? consultas.mapa(cargo.id, uf, local.mun, vale) : null, atualizaMapa);
  const mapaAtual = uf ? mapaUf : mapaBr;

  // Cargos estaduais não têm resultado nacional: no nível Brasil mostramos o resumo por estado.
  const precisaUf = cargo?.escopo === 'uf' && !uf;
  const resultado = useConsulta(cargo && !precisaUf ? consultas.resultado(cargo.id, local, vale) : null, {
    intervalo: intervaloResultado,
    sse: apuracao.aoVivo && cargo && !precisaUf ? urlAoVivo(cargo.id, local) : null,
    incompleto: completarResultado,
  });

  // 2º turno: os dois finalistas, com as cores usadas no placar e no mapa.
  const segundoTurno = cargo?.turno === 2;
  const par = segundoTurno ? finalistas(resultado.data) : null;
  const chavePar = par?.map((c) => `${c.numero}${c.partido}`).join() ?? '';
  const coresDuelo = useMemo(() => coresFinalistas(par), [chavePar]);
  const corLider = useMemo(() => corDoLider(coresDuelo), [coresDuelo]);
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

  // Região do mapa (feature da malha) → chave dos dados (código TSE do município ou UF), e o nome dela.
  const chaveRegiao = useMemo(
    () => (f: Feature) => (temMalha ? porIbge.get(String(f.properties?.ibge))?.cd : f.properties?.uf),
    [temMalha, porIbge],
  );
  const nomeRegiao = useMemo(
    () => (k: string) => (temMalha ? titulo(porCd.get(k)?.nome ?? k) : UF_NOMES[k] ?? k),
    [temMalha, porCd],
  );

  if (!config || !cargo) return { pronta: false as const, erroConfig, config, cargo, local, municipios, apuracao };

  // Fase da eleição (antes / votando / aguardando boletins / apurando) para o aviso do topo.
  const situacao = situacaoApuracao(resultado, mapaAtual);
  const fase = faseVotacao(cargo, apuracao.agora, situacao.pctApurado, situacao.tseIndisponivel, situacao.carregando);

  return {
    pronta: true as const,
    config, cargo, uf, local, flags: config.flags, apuracao, fase, situacao,
    municipios, munsUf, porCd, munAtual, temMalha, precisaUf, segundoTurno,
    geo, erroGeo, chaveRegiao, nomeRegiao, zonasNoMapa,
    mapaBr, mapaUf, mapaZonas, mapaAtual,
    resultado, resultado1t,
    placar: placarDe(cargo, resultado.data, par, coresDuelo),
    corLider,
    casa, composicao,
  };
}

export type DadosTela = Extract<ReturnType<typeof useDadosTela>, { pronta: true }>;
