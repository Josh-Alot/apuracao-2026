import type { Cargo, MapaDados, Resultado } from '../lib/types';

export type FaseVotacao = 'antes' | 'votando' | 'carregando' | 'aguardando' | 'indisponivel' | 'apurando';

/**
 * Em que momento da eleição estamos, pelo relógio e pelo % já apurado.
 * `tseIndisponivel`: depois do fechamento, nenhum dado chegou porque a consulta ao TSE falhou.
 * `carregando`: os dados da aba ainda estão a caminho — não dá para saber se há boletins.
 */
export function faseVotacao(
  cargo: Cargo, agora: number, pctApurado: number | null, tseIndisponivel = false, carregando = false,
): FaseVotacao {
  if (!cargo.abertura || !cargo.encerramento) return 'apurando';
  if (agora < Date.parse(cargo.abertura)) return 'antes';
  if (agora < Date.parse(cargo.encerramento)) return 'votando';
  if (pctApurado) return 'apurando';
  if (carregando) return 'carregando';
  return tseIndisponivel ? 'indisponivel' : 'aguardando';
}

interface Consultado<T> { data: T | null; erro: string | null }

/**
 * O que a tela já sabe da apuração, pelo resultado e pelo mapa do nível atual (Brasil ou UF): regiões com dado,
 * % apurado e se o TSE respondeu. O mapa devolve null nas regiões cuja consulta ao TSE falhou: só contam as que vieram.
 */
export function situacaoApuracao(resultado: Consultado<Resultado>, mapa: Consultado<MapaDados>) {
  const regioes = Object.values(mapa.data ?? {});
  const comDado = regioes.filter((x) => x != null);
  const pctApurado = resultado.data?.secoes.pct ?? Math.max(0, ...comDado.map((x) => x.pctApurado ?? 0));
  const temDado = !!(resultado.data || comDado.length);
  // Sem nenhum dado e com erro na consulta: o TSE não respondeu (429, fora do ar), não é falta de boletim.
  const tseIndisponivel = !temDado && !!(resultado.erro || mapa.erro || regioes.length);
  return {
    regioesTotal: regioes.length,
    regioesComDado: comDado.length,
    pctApurado: temDado ? pctApurado : null,
    tseIndisponivel,
    // Sem dado e sem erro = ainda carregando (ex.: acabou de trocar de aba): sem faixa. "Urnas fechadas"
    // só quando o TSE de fato respondeu com 0% apurado.
    carregando: !temDado && !tseIndisponivel,
  };
}

/** Texto da faixa de status. */
export function rotuloEstado(fase: FaseVotacao, { encerrada, aoVivo }: { encerrada: boolean; aoVivo: boolean }) {
  if (fase === 'votando') return 'Votação em andamento';
  if (fase === 'antes') return 'Votação ainda não começou';
  if (fase === 'aguardando') return 'Urnas fechadas';
  if (fase === 'indisponivel') return 'TSE indisponível';
  if (encerrada) return 'Apuração encerrada';
  return aoVivo ? 'Ao vivo' : 'Atualização periódica';
}
