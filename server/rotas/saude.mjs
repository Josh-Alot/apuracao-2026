// GET /api/saude (fila do TSE, cache, arquivo próprio e memória) e o alerta de memória no log.

import { estadoFila } from '../tse.mjs';
import { estadoArquivo } from '../arquivo.mjs';
import { SIMULACAO } from '../simulacao.mjs';
import { malhasEmMemoria } from './geo.mjs';

/** Diagnóstico: fila de consultas ao TSE, cache e memória. */
export const saude = () => ({
  fila: estadoFila(), arquivo: estadoArquivo(), simulacao: SIMULACAO, memoriaMB: Math.round(process.memoryUsage().rss / 2 ** 20),
  memoria: memoria(),
});

/** Memória do processo em MB: rss (o que o Render conta, limite de 512), heap do V8 e buffers fora dele. */
function memoria() {
  const m = process.memoryUsage();
  const mb = (n) => Math.round(n / 2 ** 20);
  return { rss: mb(m.rss), heap: mb(m.heapUsed), heapTotal: mb(m.heapTotal), externo: mb(m.external), buffers: mb(m.arrayBuffers) };
}

// No log do Render, a cada minuto: estado da fila quando há algo esperando e a memória quando passa de
// 400 MB (o Render reinicia o serviço em 512 MB sem deixar nada no log; assim fica o rastro do que cresceu).
const ALERTA_RSS_MB = 400;
export function vigiarMemoria() {
  setInterval(() => {
    const f = estadoFila();
    if (f.alta + f.media + f.baixa) console.log('fila TSE', JSON.stringify(f));
    const m = memoria();
    if (m.rss > ALERTA_RSS_MB) console.warn('memória alta', JSON.stringify({ ...m, cacheMB: f.cacheMB, malhas: malhasEmMemoria() }));
  }, 60_000).unref();
}
