// Cliente da API pública de divulgação de resultados do TSE (resultados.tse.jus.br).
// O TSE não envia cabeçalhos CORS, por isso todo acesso passa por este servidor.

import { readFile } from 'node:fs/promises';
import { applyDemo, demoProgresso } from './demo.mjs';

export const TSE_BASE = 'https://resultados.tse.jus.br/oficial';
export const CICLO = process.env.CICLO || 'ele2026';
const DEMO = process.env.DEMO === '1';

/**
 * Horário de votação: desde 2022 é unificado em todo o país, das 8h às 17h de Brasília.
 * ENCERRAMENTO (ISO 8601) sobrescreve o fim da votação para testes — ex.: ENCERRAMENTO=2026-10-04T18:00:00-03:00.
 * No modo demo o aviso fica desligado (os números são simulados), a menos que ENCERRAMENTO seja definido.
 */
function horarios(ddmmaaaa) {
  const [d, m, a] = ddmmaaaa.split('/');
  const dia = `${a}-${m}-${d}`;
  if (process.env.ENCERRAMENTO) {
    return { abertura: `${dia}T08:00:00-03:00`, encerramento: process.env.ENCERRAMENTO };
  }
  if (DEMO) return { abertura: null, encerramento: null };
  return { abertura: `${dia}T08:00:00-03:00`, encerramento: `${dia}T17:00:00-03:00` };
}

// Cargos que o app exibe (Conselheiro Distrital e consultas populares ficam de fora).
const CARGOS_SUPORTADOS = new Set(['1', '3', '5', '6', '7', '8']);
const TIPOS_ELEICAO = new Set(['8', '1']); // 8 = federal, 1 = estadual

export const UFS = [
  'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa',
  'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to',
];

// ---------- cache em memória com deduplicação de requisições ----------

// O cache é limitado (LRU pelo tamanho do JSON): sem limite, navegar pelos mapas estaduais guarda
// milhares de arquivos de município e estoura os 512 MB do Render gratuito (o processo trava e o
// health check falha). Em memória o JSON ocupa ~6x o tamanho do texto: 40 MB de texto ≈ 250 MB.
const CACHE_MAX_BYTES = Number(process.env.CACHE_MB || 40) * 1024 * 1024;
// url -> { ts, data, bytes, expira, etag, modificado, norm, normBytes }
// (ordem de inserção = do menos ao mais recente; `norm` = resultado já normalizado, ver deRaw)
const cache = new Map();
let cacheBytes = 0;
const inflight = new Map(); // url -> Promise

const pesoDe = (e) => e.bytes + (e.normBytes || 0);

function aparar() {
  for (const [u, e] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cache.delete(u);
    cacheBytes -= pesoDe(e);
  }
}

/** Guarda no cache. `meta` traz validade e validadores HTTP (expira, etag, modificado). */
function guardar(url, data, bytes, meta = {}) {
  const antigo = cache.get(url);
  if (antigo) {
    cacheBytes -= pesoDe(antigo);
    cache.delete(url);
  }
  const e = { ts: Date.now(), data, bytes, ...meta };
  // Mesmo JSON (resposta 304): aproveita a normalização já feita.
  if (antigo && antigo.data === data && antigo.norm) {
    e.norm = antigo.norm;
    e.normBytes = antigo.normBytes;
  }
  cache.set(url, e);
  cacheBytes += pesoDe(e);
  aparar();
}

// O Akamai do TSE guarda cada arquivo por ~60 s e informa quanto falta em `cache-control: max-age`.
// Antes disso, consultar de novo só devolve o mesmo arquivo — e gasta a cota da fila.
const MAX_AGE_TETO_S = 300;
function metaHttp(res, antigo) {
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1]);
  return {
    expira: maxAge > 0 ? Date.now() + Math.min(maxAge, MAX_AGE_TETO_S) * 1000 : 0,
    etag: res.headers.get('etag') || antigo?.etag || null,
    modificado: res.headers.get('last-modified') || antigo?.modificado || null,
  };
}

/** O dado em cache ainda vale: pelo TTL pedido, até `validoAte` ou enquanto o Akamai não renova. */
function vale(hit, ttlMs, validoAte = 0) {
  const agora = Date.now();
  return agora - hit.ts < ttlMs || agora < validoAte || agora < (hit.expira || 0);
}

function lerCache(url) {
  const hit = cache.get(url);
  if (hit) { // marca como usado agora (vai para o fim da fila de descarte)
    cache.delete(url);
    cache.set(url, hit);
  }
  return hit;
}

/** Erro de consulta ao TSE que já foi registrado no log de forma resumida (sem pilha). */
export class ErroTse extends Error {
  constructor(msg, status = 503) { super(msg); this.status = status; this.silencioso = true; }
}

// O TSE (atrás do Akamai) limita requisições por IP bem abaixo do que diz o cabeçalho
// x-ratelimit-limit: rajadas de poucas consultas já recebem HTTP 429. Ao receber 429, TODAS as
// consultas ao TSE param por um tempo (Retry-After / x-ratelimit-reset, dobrando a cada 429
// seguido, até 60 s): quem tem dado em cache recebe o dado antigo; quem não tem recebe 503.
let pausaAte = 0;
let pausaMs = 0;
// Outras falhas (5xx, rede) pausam só aquela URL por alguns segundos.
const falhaAte = new Map(); // url -> ms
const FALHA_MS = 5_000;

function pausarTse(res) {
  const pedido = Number(res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset')) * 1000;
  pausaMs = Math.min(60_000, Math.max(pedido || 0, pausaMs ? pausaMs * 2 : 2_000));
  pausaAte = Date.now() + pausaMs;
  console.warn(`TSE respondeu 429: consultas pausadas por ${pausaMs / 1000} s`);
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
function aguardarVez(url, prioridade) {
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
function promover(url, prioridade) {
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
export function estadoFila() {
  return { rps: Math.round(rps * 100) / 100, alta: filas[0].length, media: filas[1].length, baixa: filas[2].length, cache: cache.size, cacheMB: Math.round(cacheBytes / 2 ** 20) };
}

/**
 * Busca JSON com cache: vale por `ttlMs` ou, se informado, até o instante `validoAte` (ms).
 * Consultas ao TSE entram na fila com a `prioridade` dada.
 */
export async function fetchJson(url, ttlMs, validoAte = 0, prioridade = PRIORIDADE.alta) {
  const hit = lerCache(url);
  if (hit && vale(hit, ttlMs, validoAte)) return hit.data;
  if (inflight.has(url)) {
    promover(url, prioridade);
    return inflight.get(url);
  }
  const doTse = url.startsWith(TSE_BASE);
  const espera = Math.max(doTse ? pausaAte : 0, falhaAte.get(url) ?? 0) - Date.now();
  if (espera > 0) {
    if (hit) return hit.data;
    throw new ErroTse(`Consulta ao ${doTse ? 'TSE' : 'serviço externo'} pausada após falha; nova tentativa em ${Math.ceil(espera / 1000)} s`);
  }

  const p = (async () => {
    try {
      if (doTse && !(await aguardarVez(url, prioridade))) {
        throw new ErroTse('Consulta ao TSE descartada (fila cheia)');
      }
      // Requisição condicional: se o arquivo não mudou, o TSE responde 304 sem corpo e o JSON
      // (e a normalização) em cache continuam valendo.
      const headers = { 'user-agent': 'apuracao-2026/0.1' };
      if (hit?.data && hit.etag) headers['if-none-match'] = hit.etag;
      else if (hit?.data && hit.modificado) headers['if-modified-since'] = hit.modificado;
      const res = await fetch(url, { headers });
      if (res.status === 304 && hit?.data) {
        guardar(url, hit.data, hit.bytes, metaHttp(res, hit));
        falhaAte.delete(url);
        if (doTse) {
          pausaMs = 0;
          ajustarTaxa(false);
        }
        return hit.data;
      }
      if (res.status === 404 || res.status === 403) {
        guardar(url, null, 0);
        return null;
      }
      if (res.status === 429 && doTse) {
        ajustarTaxa(true);
        pausarTse(res);
        throw new ErroTse('TSE limitou as consultas (HTTP 429); tentando de novo em instantes');
      }
      if (!res.ok) throw new ErroTse(`HTTP ${res.status} em ${url}`, 502);
      const texto = await res.text();
      const data = JSON.parse(texto);
      guardar(url, data, texto.length, metaHttp(res));
      falhaAte.delete(url);
      if (doTse) {
        pausaMs = 0;
        ajustarTaxa(false);
      }
      return data;
    } catch (err) {
      if (!(err instanceof ErroTse) || err.status === 502) {
        falhaAte.set(url, Date.now() + FALHA_MS);
        if (!(err instanceof ErroTse)) console.warn(`Falha ao consultar ${url}: ${err.message}`);
      }
      if (hit) return hit.data; // devolve dado antigo se o TSE oscilar
      throw err instanceof ErroTse ? err : new ErroTse(`Falha ao consultar o TSE: ${err.message}`, 502);
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

/** Executa `fn` sobre `items` com no máximo `limit` promessas simultâneas. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- URLs ----------

const pad = (s, n) => String(s).padStart(n, '0');

export function resultadoUrl({ eleicao, cargo, uf, mun, zona }) {
  let abr = uf;
  if (mun) abr += mun;
  if (zona) abr += `-z${pad(zona, 4)}`;
  return `${TSE_BASE}/${CICLO}/${eleicao}/dados/${uf}/${abr}-c${pad(cargo, 4)}-e${pad(eleicao, 6)}-u.json`;
}

export function fotoUrl(eleicao, uf, sqcand) {
  return `${TSE_BASE}/${CICLO}/${eleicao}/fotos/${uf}/${sqcand}.jpeg`;
}

// ---------- configuração ----------

// Cópia do ele-c.json guardada no repositório: sem ela, um 429 logo após reiniciar (cache vazio)
// derrubaria todas as rotas, já que todas dependem da configuração.
const CONFIG_RESERVA = new URL('../dados/ele-c.json', import.meta.url);
let configReserva = null;

async function configTse() {
  try {
    const raw = await fetchJson(`${TSE_BASE}/comum/config/ele-c.json`, 5 * 60_000);
    if (raw) return raw;
  } catch { /* usa a cópia local abaixo */ }
  configReserva ??= readFile(CONFIG_RESERVA, 'utf8').then(JSON.parse);
  return configReserva;
}

// getConfig() é chamada em quase toda requisição: só remonta quando o ele-c.json muda.
let configMemo = { raw: null, cfg: null };

export async function getConfig() {
  const raw = await configTse();
  if (configMemo.raw === raw) return configMemo.cfg;
  const cargos = [];
  for (const pl of raw.pl.filter((p) => p.c === CICLO)) {
    for (const e of pl.e) {
      if (!TIPOS_ELEICAO.has(e.tp)) continue;
      for (const abr of e.abr) {
        for (const cp of abr.cp) {
          if (!CARGOS_SUPORTADOS.has(cp.cd)) continue;
          const id = `${e.cd}-${cp.cd}`;
          let item = cargos.find((c) => c.id === id);
          if (!item) {
            item = {
              id,
              eleicao: e.cd,
              cargo: cp.cd,
              nome: cp.ds + (e.t === '2' ? ' (2º turno)' : ''),
              turno: Number(e.t),
              data: pl.dt,
              ...horarios(pl.dt),
              tipo: cp.tp === '2' ? 'proporcional' : 'majoritario',
              escopo: cp.cd === '1' ? 'br' : 'uf',
              ufs: [],
            };
            cargos.push(item);
          }
          item.ufs.push(abr.cd);
        }
      }
    }
  }
  // "br" na abrangência = vale para todas as UFs (com exceções conhecidas).
  for (const c of cargos) {
    if (c.ufs.includes('br')) {
      if (c.cargo === '1') c.ufs = [...UFS, 'zz'];
      else if (c.cargo === '7') c.ufs = UFS.filter((u) => u !== 'df');
      else if (c.cargo === '8') c.ufs = ['df'];
      else c.ufs = [...UFS];
    }
  }
  const ordem = ['1', '3', '5', '6', '7', '8'];
  cargos.sort((a, b) => a.turno - b.turno || ordem.indexOf(a.cargo) - ordem.indexOf(b.cargo));
  const cfg = { ciclo: CICLO, demo: DEMO, cargos };
  configMemo = { raw, cfg };
  return cfg;
}

export async function getMunicipios(eleicao) {
  const raw = await fetchJson(
    `${TSE_BASE}/${CICLO}/${eleicao}/config/mun-e${pad(eleicao, 6)}-cm.json`,
    30 * 60_000,
  );
  if (!raw) return null;
  const out = {};
  for (const uf of raw.abr) {
    out[uf.cd] = {
      nome: uf.ds,
      municipios: uf.mu.map((m) => ({
        cd: m.cd,
        ibge: m.cdi || null,
        nome: m.nm,
        capital: m.c === 's',
        zonas: m.z,
      })),
    };
  }
  return out;
}

// ---------- resultados ----------

/**
 * Situação do candidato a partir do texto `st` do TSE. Não dá para confiar só em `e` ("s"/"n"):
 * quem vai ao 2º turno também vem com e = "s". Valores vistos nas eleições de 2024:
 * majoritário — "Eleito", "2º turno", "Não eleito";
 * proporcional — "Eleito por QP" (quociente partidário), "Eleito por média", "Suplente", "Não eleito".
 * Vazio = ainda indefinido (apuração em andamento). Textos desconhecidos seguem como "outro".
 */
function classificar(st, e) {
  const t = (st || '').trim();
  if (!t) return { status: e === 's' ? 'eleito' : null, detalhe: null };
  if (/2.?\s*turno/i.test(t)) return { status: 'segundo-turno', detalhe: null };
  if (/^n[aã]o eleit/i.test(t)) return { status: 'nao-eleito', detalhe: null };
  if (/^eleit/i.test(t)) {
    const m = t.match(/por\s+(.+)$/i);
    return { status: 'eleito', detalhe: m ? `por ${m[1]}` : null };
  }
  if (/suplente/i.test(t)) return { status: 'suplente', detalhe: null };
  return { status: 'outro', detalhe: t };
}

const int = (s) => (s == null || s === '' ? 0 : parseInt(s, 10) || 0);
const pct = (s) => (s == null || s === '' ? 0 : parseFloat(String(s).replace(',', '.')) || 0);

/**
 * Até o fechamento das urnas o TSE só publica arquivos zerados (nem o exterior é divulgado antes).
 * Então cada arquivo de resultado é buscado no máximo uma vez e guardado até lá — a consulta
 * recorrente ao TSE só começa às 17h de Brasília. Devolve 0 quando a apuração já abriu (ou no demo).
 */
async function fimDaVotacao(eleicao) {
  const fim = (await getConfig()).cargos.find((c) => c.eleicao === eleicao)?.encerramento;
  const ms = fim ? Date.parse(fim) : 0;
  return ms > Date.now() ? ms : 0;
}

export async function getResultado(params, ttlMs = 20_000, prioridade = PRIORIDADE.alta) {
  const url = resultadoUrl(params);
  const r = deRaw(await fetchJson(url, ttlMs, await fimDaVotacao(params.eleicao), prioridade), params, url);
  // Abaixo da abrangência da disputa (município, zona, UF do Presidente), "matematicamente eleito/2º turno"
  // vem do arquivo da disputa — que é o mesmo para todos, fica em cache e já é o mais consultado.
  if (r && (params.mun || params.zona || escopoDaDisputa(params.cargo) !== (params.uf === 'br' ? 'br' : 'uf'))) {
    const disputa = { eleicao: params.eleicao, cargo: params.cargo, uf: escopoDaDisputa(params.cargo) === 'br' ? 'br' : params.uf };
    const geral = await getResultado(disputa, 20_000, prioridade).catch(() => null);
    const situacao = new Map(geral?.candidatos.map((c) => [c.sq, c]));
    for (const c of r.candidatos) {
      c.matematicamente = situacao.get(c.sq)?.matematicamente ?? null;
      c.chapa = situacao.get(c.sq)?.chapa ?? null;
    }
  }
  return r;
}

/**
 * Resultado normalizado, guardado junto do JSON no cache: o mapa estadual lê centenas de arquivos
 * a cada atualização e o "ao vivo" relê o mesmo a cada 5 s — normalizar de novo só quando o JSON muda.
 * O normalizado conta no limite do cache (estimado em metade do tamanho do texto).
 */
function deRaw(raw, params, url) {
  if (!raw || !raw.carg?.length) return null;
  if (DEMO) return normalizar(applyDemo(raw), params); // a demo muda com o tempo
  const e = cache.get(url);
  if (e?.data !== raw) return normalizar(raw, params);
  if (!e.norm) {
    e.norm = normalizar(raw, params);
    e.normBytes = e.bytes >> 1;
    cacheBytes += e.normBytes;
    aparar();
  }
  return e.norm;
}

/** Todas as seções totalizadas: o líder não muda mais (o mapa pode renovar bem devagar). */
const apuracaoCompleta = (raw) => !DEMO && pct(raw?.s?.pst) >= 100;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Vários resultados de uma vez sem prender a resposta na fila (mapas e busca): espera no máximo
 * `esperaMs` pelo que precisa ser consultado e devolve o que houver — o dado em cache (mesmo
 * vencido), null se o TSE não tem o arquivo, ou undefined se ainda não chegou (segue na fila e
 * entra na próxima atualização).
 */
export async function getResultadosRapidos(lista, ttlMs, prioridade, { esperaMs = 4_000, ttlCompletoMs = ttlMs } = {}) {
  const fim = await fimDaVotacao(lista[0]?.eleicao);
  const urls = lista.map(resultadoUrl);
  const pendentes = urls.map((url) => {
    const ttl = apuracaoCompleta(cache.get(url)?.data) ? Math.max(ttlMs, ttlCompletoMs) : ttlMs;
    return fetchJson(url, ttl, fim, prioridade).catch(() => undefined);
  });
  await Promise.race([Promise.allSettled(pendentes), dormir(esperaMs)]);
  return lista.map((params, i) => {
    const hit = cache.get(urls[i]);
    return hit ? deRaw(hit.data, params, urls[i]) : undefined;
  });
}

/**
 * "Matematicamente eleito": mesmo que todos os eleitores das seções ainda não totalizadas (`e.esnt`)
 * votassem contra, o candidato não perde a vaga. Só vale no arquivo da disputa (BR para Presidente,
 * UF para os demais cargos). Conservador de propósito: votos anulados sub judice contam como se
 * fossem validados para os rivais, e no proporcional só entra a vaga pelo quociente partidário
 * (as sobras ficam de fora). No executivo também marca quem já tem o 2º turno garantido.
 * Devolve Map sqcand → 'eleito' | 'segundo-turno'.
 */
function situacaoMatematica(raw, candidatos, grupos) {
  const carg = raw.carg[0];
  const faltam = int(raw.e?.esnt);
  const validos = int(raw.v?.vv);
  const subJudice = int(raw.v?.vansj);
  const vagas = int(carg.nv) || 1;
  const out = new Map();
  const podeSerEleito = (c) => c.votos > 0 && c.destinoVotos === 'Válido';

  if (carg.cd === '1' || carg.cd === '3') {
    // Presidente e Governador: maioria absoluta dos votos válidos no 1º turno.
    const tetoValidos = validos + subJudice + faltam;
    for (const c of candidatos) if (podeSerEleito(c) && 2 * c.votos > tetoValidos) out.set(c.sq, 'eleito');
    if (out.size) return out;

    // 2º turno garantido: (1) ninguém mais pode ter maioria — dando a cada um todos os votos que
    // faltam (que também entram nos válidos); um sub judice validado soma os votos dele aos válidos —
    // e (2) o candidato fica entre os 2 primeiros: cada eleitor vota uma vez, então os dois rivais
    // mais próximos precisariam, juntos, de mais votos do que faltam. Empate conta como ameaça.
    const alguemPodeVencer = candidatos.some((c) => (c.destinoVotos === 'Válido'
      ? 2 * c.votos + faltam > validos
      : c.votos + faltam > validos));
    if (alguemPodeVencer) return out;
    for (const c of candidatos) {
      if (!podeSerEleito(c)) continue;
      const [a = Infinity, b = Infinity] = candidatos.filter((o) => o !== c)
        .map((o) => Math.max(0, c.votos - o.votos)).sort((x, y) => x - y);
      if (a + b > faltam) out.set(c.sq, 'segundo-turno');
    }
  } else if (carg.cd === '5') {
    // Senado: os `vagas` mais votados. Cada eleitor dá no máximo 1 voto a cada candidato, então
    // cada rival pode receber até `faltam` votos. Empate conta como ameaça (desempate é por idade).
    for (const c of candidatos) {
      if (!podeSerEleito(c)) continue;
      const ameacas = candidatos.filter((o) => o !== c && o.votos + faltam >= c.votos).length;
      if (ameacas < vagas) out.set(c.sq, 'eleito');
    }
  } else {
    // Proporcional (só a vaga pelo quociente partidário). O adversário divide os votos que faltam:
    // os que vão para outras agremiações aumentam o QE; os que vão para colegas de chapa os põem à
    // frente, mas também somam ao partido. Com o QE no máximo possível, as vagas por QP são no mínimo
    // floor((votos do grupo + y) / QE máx.) quando y votos vão para colegas. Basta testar y = 0 e
    // os pontos em que mais um colega alcança o candidato (soma das menores diferenças).
    const teto = validos + subJudice + faltam;
    const qeMax = Math.ceil(teto / vagas) + 1; // o TSE arredonda o QE; +1 cobre o arredondamento
    const doGrupo = new Map(); // agremiação → índices dos candidatos
    grupos.agrDe.forEach((agr, i) => {
      if (!doGrupo.has(agr)) doGrupo.set(agr, []);
      doGrupo.get(agr).push(i);
    });
    candidatos.forEach((c, i) => {
      if (!podeSerEleito(c) || c.votos < 0.1 * qeMax) return; // mínimo de 10% do QE
      const agr = grupos.agrDe[i];
      const total = grupos.get(agr);
      const diferencas = doGrupo.get(agr).filter((j) => j !== i)
        .map((j) => Math.max(0, c.votos - candidatos[j].votos)) // empate conta como "à frente"
        .sort((a, b) => a - b);
      let y = 0;
      for (let k = 0; k <= diferencas.length; k++) {
        // k colegas à frente custam y votos; o candidato precisa de mais de k vagas.
        if (k > 0) y += diferencas[k - 1];
        if (y > faltam) break;
        if (Math.floor((total + y) / qeMax) <= k) return;
      }
      out.set(c.sq, 'eleito');
    });
  }
  return out;
}

/**
 * QE (Código Eleitoral, art. 106): votos válidos (nominais + legenda) ÷ vagas, desprezada a fração
 * igual ou inferior a meio e arredondada para 1 a superior. Em inteiros, porque `Math.round` sobe o
 * meio exato. Só é usado se o arquivo do TSE não trouxer `carg.qe`.
 */
function quocienteEleitoral(validos, vagas) {
  const q = Math.floor(validos / vagas);
  return 2 * (validos - q * vagas) > vagas ? q + 1 : q;
}

/**
 * Proporcional: ordem de suplência na chapa (partido isolado ou federação) e o "efeito puxador" —
 * eleito com menos votos que o quociente eleitoral (QE), numa chapa em que alguém passou do QE
 * (o puxador). Com a situação oficial do TSE (`st`) usa eleitos e suplentes oficiais; antes dela,
 * projeta pelas vagas que o TSE calcula para cada chapa (`agr.vag`): ficam com elas os mais votados
 * da chapa com ao menos 10% do QE. Suplência = demais candidatos com votos válidos, por votos.
 * Devolve Map sqcand → { suplente, puxadoPor, puxou, qe, projecao }.
 */
function chapas(raw, candidatos, grupos) {
  const carg = raw.carg[0];
  const out = new Map();
  const qe = int(carg.qe) || quocienteEleitoral(int(raw.v?.vv), int(carg.nv) || 1);
  if (!qe) return out;
  const oficial = candidatos.some((c) => c.status === 'eleito' || c.status === 'suplente');
  const porChapa = new Map(); // agremiação → candidatos
  candidatos.forEach((c, i) => {
    const agr = grupos.agrDe[i];
    if (!porChapa.has(agr)) porChapa.set(agr, []);
    porChapa.get(agr).push(c);
  });
  for (const [agr, cs] of porChapa) {
    const validos = cs.filter((c) => c.destinoVotos === 'Válido' && c.votos > 0).sort((a, b) => b.votos - a.votos);
    let eleitos;
    let suplentes;
    if (oficial) {
      eleitos = validos.filter((c) => c.status === 'eleito');
      suplentes = validos.filter((c) => c.status === 'suplente');
    } else {
      eleitos = validos.filter((c) => c.votos >= 0.1 * qe).slice(0, int(agr.vag));
      suplentes = validos.filter((c) => !eleitos.includes(c));
    }
    const puxador = eleitos.find((c) => c.votos >= qe); // eleitos em ordem de votos: o mais votado
    const puxados = puxador ? eleitos.filter((c) => c.votos < qe) : [];
    const base = { suplente: null, puxadoPor: null, puxou: 0, qe, projecao: !oficial };
    for (const c of eleitos) {
      out.set(c.sq, { ...base, puxadoPor: puxados.includes(c) ? puxador.nomeUrna : null, puxou: c === puxador ? puxados.length : 0 });
    }
    suplentes.forEach((c, k) => out.set(c.sq, { ...base, suplente: k + 1 }));
  }
  return out;
}

const PROPORCIONAIS = new Set(['6', '7', '8']);

/** Abrangência em que a disputa é decidida: Brasil para Presidente, UF para os demais cargos. */
const escopoDaDisputa = (cargo) => (String(cargo) === '1' ? 'br' : 'uf');

function normalizar(raw, { eleicao, uf }) {
  const carg = raw.carg[0];
  const fotoUf = carg.cd === '1' ? 'br' : uf;
  const candidatos = [];
  // Agremiação (partido isolado ou federação) de cada candidato e o total dela (nominais + legenda).
  const grupos = new Map();
  grupos.agrDe = [];
  for (const agr of carg.agr ?? []) {
    grupos.set(agr, (agr.par ?? []).reduce((t, par) => t + int(par.tvtn) + int(par.tvtl), 0));
    for (const par of agr.par ?? []) {
      for (const c of par.cand ?? []) {
        grupos.agrDe.push(agr);
        candidatos.push({
          numero: c.n,
          sq: c.sqcand,
          nome: c.nm,
          nomeUrna: c.nmu,
          partido: par.sg,
          coligacao: agr.tp === 'c' ? agr.com : null,
          votos: int(c.vap),
          pct: pct(c.pvap),
          ...classificar(c.st, c.e),
          situacao: c.st || null,
          // Para onde vão os votos: "Válido", "Válido (legenda)", "Anulado", "Anulado sub judice".
          destinoVotos: c.dvt || null,
          vices: (c.vs ?? []).map((v) => ({ tipo: v.tp, sq: v.sqcand, nome: v.nmu, partido: v.sgp, foto: fotoUrl(eleicao, fotoUf, v.sqcand) })),
          foto: fotoUrl(eleicao, fotoUf, c.sqcand),
          matematicamente: null,
          chapa: null,
        });
      }
    }
  }
  if (raw.tpabr === escopoDaDisputa(carg.cd)) {
    const situacao = situacaoMatematica(raw, candidatos, grupos);
    for (const c of candidatos) c.matematicamente = situacao.get(c.sq) ?? null;
    if (PROPORCIONAIS.has(carg.cd)) {
      const chapa = chapas(raw, candidatos, grupos);
      for (const c of candidatos) c.chapa = chapa.get(c.sq) ?? null;
    }
  }
  candidatos.sort((a, b) => b.votos - a.votos || a.nomeUrna.localeCompare(b.nomeUrna, 'pt-BR'));

  const s = raw.s ?? {};
  const e = raw.e ?? {};
  const v = raw.v ?? {};
  return {
    cargo: { cd: carg.cd, nome: carg.nmn, vagas: int(carg.nv) },
    abrangencia: { tipo: raw.tpabr, cd: raw.cdabr },
    atualizado: raw.dg ? `${raw.dg} ${raw.hg}` : null,
    totalizado: raw.tf === 's',
    secoes: { total: int(s.ts), totalizadas: int(s.st), pct: pct(s.pst) },
    eleitorado: {
      total: int(e.te),
      comparecimento: int(e.c),
      pctComparecimento: pct(e.pc),
      abstencao: int(e.a),
      pctAbstencao: pct(e.pa),
    },
    votos: {
      total: int(v.tv),
      validos: int(v.vv),
      pctValidos: pct(v.pvv),
      brancos: int(v.vb),
      pctBrancos: pct(v.pvb),
      nulos: int(v.tvn),
      pctNulos: pct(v.ptvn),
    },
    candidatos,
  };
}

/** Resumo enxuto usado para colorir o mapa. */
export function resumo(r) {
  if (!r) return null;
  const lider = r.candidatos[0];
  return {
    pctApurado: r.secoes.pct,
    lider: lider && lider.votos > 0
      ? { numero: lider.numero, nome: lider.nomeUrna, partido: lider.partido, pct: lider.pct, votos: lider.votos }
      : null,
  };
}

/**
 * Apuração encerrada: 100% das seções totalizadas em todas as UFs da eleição, pelo arquivo de
 * abrangência nacional (`br-e<ele6>-ab.json`, 1 consulta por eleição, em cache por 5 min). Antes do
 * fechamento das urnas (ou no demo) nem consulta. Na dúvida (TSE fora), responde false — o front
 * continua "ao vivo", como antes.
 */
export async function apuracaoEncerrada(eleicao) {
  if (DEMO || (await fimDaVotacao(eleicao))) return false;
  try {
    const raw = await fetchJson(`${TSE_BASE}/${CICLO}/${eleicao}/dados/br/br-e${pad(eleicao, 6)}-ab.json`, 5 * 60_000);
    const ufs = raw?.abr?.filter((a) => a.tpabr === 'uf') ?? [];
    return ufs.length > 0 && ufs.every((a) => pct(a.s?.pst) >= 100);
  } catch {
    return false;
  }
}

/** Percentual de seções totalizadas por município, a partir do arquivo de abrangência (1 requisição por UF). */
export async function getAbrangencia(eleicao, uf) {
  const raw = await fetchJson(
    `${TSE_BASE}/${CICLO}/${eleicao}/dados/${uf}/${uf}-e${pad(eleicao, 6)}-ab.json`, 30_000, await fimDaVotacao(eleicao),
    PRIORIDADE.media,
  );
  const out = {};
  for (const a of raw?.abr ?? []) {
    if (a.tpabr !== 'mun') continue;
    const pctApurado = DEMO ? Math.round(demoProgresso(`mu:${a.cdabr}`) * 10000) / 100 : pct(a.s?.pst);
    out[a.cdabr] = { pctApurado, lider: null };
  }
  return out;
}
