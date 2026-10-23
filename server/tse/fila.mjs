// Fila das consultas ao TSE: taxa máxima, prioridade e pausa geral após HTTP 429.

// O TSE (atrás do Akamai) limita requisições por IP bem abaixo do que diz o cabeçalho
// x-ratelimit-limit: rajadas de poucas consultas já recebem HTTP 429. Ao receber 429, TODAS as
// consultas ao TSE param por um tempo (Retry-After / x-ratelimit-reset, dobrando a cada 429
// seguido, até 60 s): quem tem dado em cache recebe o dado antigo; quem não tem recebe 503.
let pausaAte = 0;
let pausaMs = 0;

function pausarTse(res) {
  const pedido = Number(res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset')) * 1000;
  pausaMs = Math.min(60_000, Math.max(pedido || 0, pausaMs ? pausaMs * 2 : 2_000));
  pausaAte = Date.now() + pausaMs;
  console.warn(`TSE respondeu 429: consultas pausadas por ${pausaMs / 1000} s`);
}

/** Até quando (ms) todas as consultas ao TSE estão pausadas por 429 (0 = sem pausa). */
export const pausadoAte = () => pausaAte;

/** O TSE respondeu (200/304): zera a pausa e deixa a taxa voltar a subir. */
export function tseRespondeu() {
  pausaMs = 0;
  ajustarTaxa(false);
}

/** HTTP 429: corta a taxa pela metade e pausa todas as consultas. */
export function tseLimitou(res) {
  ajustarTaxa(true);
  pausarTse(res);
}

// ---------- fila de consultas ao TSE ----------
// Todas as consultas ao TSE passam por uma fila com taxa máxima (TSE_RPS por segundo) e prioridade:
// o resultado que alguém está vendo vem antes do mapa nacional, que vem antes dos mapas por
// município e da busca. A taxa cai pela metade a cada 429 e volta a subir aos poucos.
export const PRIORIDADE = { alta: 0, media: 1, baixa: 2 };
const RPS_MAX = Number(process.env.TSE_RPS || 3);
const RPS_MIN = 0.5;
let rps = RPS_MAX;
let ultimoDisparo = 0;
let ultimo429 = 0;
// Por prioridade: { url, liberar(ok) }. A baixa é atendida do fim (o pedido mais recente primeiro):
// quem está olhando um mapa pede de novo a cada atualização e volta para o fim; pedidos de mapas
// que ninguém olha mais afundam e são descartados quando a fila enche.
const filas = [[], [], []];
const naFila = new Map(); // url -> { item, prioridade }
const MAX_FILA_BAIXA = 3000; // acima disso descarta os pedidos mais antigos de baixa prioridade
let timerFila = null;

function agendarFila() {
  if (timerFila || !filas.some((f) => f.length)) return;
  const espera = Math.max(0, pausaAte - Date.now(), ultimoDisparo + 1000 / rps - Date.now());
  timerFila = setTimeout(() => {
    timerFila = null;
    if (Date.now() < pausaAte) return agendarFila();
    const fila = filas.find((f) => f.length);
    if (fila) {
      const item = fila === filas[PRIORIDADE.baixa] ? fila.pop() : fila.shift();
      naFila.delete(item.url);
      ultimoDisparo = Date.now();
      item.liberar(true);
    }
    agendarFila();
  }, espera);
}

/** Espera a vez de consultar o TSE. Resolve false se o pedido foi descartado (fila cheia). */
export function aguardarVez(url, prioridade) {
  return new Promise((liberar) => {
    const item = { url, liberar };
    filas[prioridade].push(item);
    naFila.set(url, { item, prioridade });
    if (filas[PRIORIDADE.baixa].length > MAX_FILA_BAIXA) {
      const velho = filas[PRIORIDADE.baixa].shift();
      naFila.delete(velho.url);
      velho.liberar(false);
    }
    agendarFila();
  });
}

/**
 * Pedido repetido de uma URL que já está na fila: sobe de prioridade se quem pede é mais
 * importante; na fila baixa, volta para o fim (é atendida antes, por ainda ter alguém olhando).
 */
export function promover(url, prioridade) {
  const f = naFila.get(url);
  if (!f || f.prioridade < prioridade) return;
  if (f.prioridade === prioridade && prioridade !== PRIORIDADE.baixa) return;
  const fila = filas[f.prioridade];
  fila.splice(fila.indexOf(f.item), 1);
  filas[prioridade].push(f.item);
  f.prioridade = prioridade;
}

function ajustarTaxa(houve429) {
  if (houve429) {
    ultimo429 = Date.now();
    rps = Math.max(RPS_MIN, rps / 2);
  } else if (rps < RPS_MAX && Date.now() - ultimo429 > 30_000) {
    rps = Math.min(RPS_MAX, rps + 0.05);
  }
}

/** Situação da fila (para o log e para /api/saude). */
export function estadoDaFila() {
  return { rps: Math.round(rps * 100) / 100, alta: filas[0].length, media: filas[1].length, baixa: filas[2].length };
}
