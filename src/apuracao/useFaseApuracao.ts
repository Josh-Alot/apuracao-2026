import type { Cargo, MapaDados } from '../lib/types';
import { VALE_APURANDO_MS, VALE_PARADO_MS } from '../api/consultas';
import { useAgora } from './AvisoVotacao';

// Com "ao vivo" ligado, os resultados chegam por stream (o servidor verifica o TSE a cada 5 s)
// e o mapa é consultado com mais frequência. Desligado, tudo é atualizado periodicamente.
export const ATUALIZA_RESULTADO_MS = 30_000;
const ATUALIZA_MAPA_MS = 60_000;
const ATUALIZA_MAPA_AO_VIVO_MS = 30_000;

// Antes das 17h e com a apuração encerrada: o mapa só é consultado de novo enquanto houver região que
// ainda não chegou (antes das 17h o servidor já guarda cada arquivo até o fechamento, então não vai ao TSE);
// encerrada, o resultado só se a consulta falhar.
const mapaIncompleto = (d: MapaDados) => Object.values(d).some((x) => x == null);
const nuncaIncompleto = () => false;

/**
 * Em que ponto está a apuração do cargo e, a partir disso, como os dados são atualizados:
 * antes das 17h nada é consultado de novo; encerrada, só se faltar algo; no meio, ao vivo ou periódico.
 */
export function useFaseApuracao(cargo: Cargo | undefined, aoVivo: boolean) {
  // Antes das 17h (fechamento das urnas) o TSE não divulga nada: carrega uma vez e não fica consultando.
  // O relógio anda a cada 15 s, então "ao vivo"/atualização periódica ligam sozinhos às 17h.
  const agora = useAgora(!!cargo?.encerramento);
  const apuracaoAberta = !cargo?.encerramento || agora >= Date.parse(cargo.encerramento);
  // Com 100% das seções totalizadas os números não mudam mais: sem "ao vivo" nem atualização periódica,
  // os dados vêm ao abrir a página e a cada navegação.
  const encerrada = !!cargo?.encerrada;
  const tempoReal = apuracaoAberta && !encerrada;
  return {
    agora,
    apuracaoAberta,
    encerrada,
    tempoReal,
    /** "Ao vivo" de fato: ligado pelo leitor (e pela flag) e com a apuração correndo. */
    aoVivo: tempoReal && aoVivo,
    intervaloMapa: !tempoReal ? 0 : aoVivo ? ATUALIZA_MAPA_AO_VIVO_MS : ATUALIZA_MAPA_MS,
    intervaloResultado: !tempoReal || aoVivo ? 0 : ATUALIZA_RESULTADO_MS,
    /** Por quanto tempo um resultado/mapa já consultado vale ao voltar a uma tela (sem nova consulta). */
    vale: tempoReal ? VALE_APURANDO_MS : VALE_PARADO_MS,
    completarMapa: encerrada || !apuracaoAberta ? mapaIncompleto : undefined,
    completarResultado: encerrada ? nuncaIncompleto : undefined,
  };
}
