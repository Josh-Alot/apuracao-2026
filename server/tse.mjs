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

const cache = new Map(); // url -> { ts, data }
const inflight = new Map(); // url -> Promise

/** Erro de consulta ao TSE que já foi registrado no log de forma resumida (sem pilha). */
export class ErroTse extends Error {
  constructor(msg, status = 503) { super(msg); this.status = status; this.silencioso = true; }
}

// O TSE limita requisições por IP (HTTP 429). No Render o IP de saída é compartilhado com outros
// serviços, então o limite pode estourar sem culpa nossa. Ao receber 429, TODAS as consultas ao TSE
// param por um tempo (Retry-After / x-ratelimit-reset, dobrando a cada 429 seguido, até 60 s):
// quem tem dado em cache recebe o dado antigo; quem não tem recebe 503 sem bater no TSE.
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

/** Busca JSON com cache: vale por `ttlMs` ou, se informado, até o instante `validoAte` (ms). */
export async function fetchJson(url, ttlMs, validoAte = 0) {
  const hit = cache.get(url);
  if (hit && (Date.now() - hit.ts < ttlMs || Date.now() < validoAte)) return hit.data;
  if (inflight.has(url)) return inflight.get(url);
  const doTse = url.startsWith(TSE_BASE);
  const espera = Math.max(doTse ? pausaAte : 0, falhaAte.get(url) ?? 0) - Date.now();
  if (espera > 0) {
    if (hit) return hit.data;
    throw new ErroTse(`Consulta ao ${doTse ? 'TSE' : 'serviço externo'} pausada após falha; nova tentativa em ${Math.ceil(espera / 1000)} s`);
  }

  const p = (async () => {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'apuracao-2026/0.1' } });
      if (res.status === 404 || res.status === 403) {
        cache.set(url, { ts: Date.now(), data: null });
        return null;
      }
      if (res.status === 429 && doTse) {
        pausarTse(res);
        throw new ErroTse('TSE limitou as consultas (HTTP 429); tentando de novo em instantes');
      }
      if (!res.ok) throw new ErroTse(`HTTP ${res.status} em ${url}`, 502);
      const data = await res.json();
      cache.set(url, { ts: Date.now(), data });
      falhaAte.delete(url);
      if (doTse) pausaMs = 0;
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

export async function getConfig() {
  const raw = await configTse();
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
  return { ciclo: CICLO, demo: DEMO, cargos };
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

export async function getResultado(params, ttlMs = 20_000) {
  let raw = await fetchJson(resultadoUrl(params), ttlMs, await fimDaVotacao(params.eleicao));
  if (!raw || !raw.carg?.length) return null;
  if (DEMO) raw = applyDemo(raw);
  return normalizar(raw, params);
}

function normalizar(raw, { eleicao, uf }) {
  const carg = raw.carg[0];
  const fotoUf = carg.cd === '1' ? 'br' : uf;
  const candidatos = [];
  for (const agr of carg.agr ?? []) {
    for (const par of agr.par ?? []) {
      for (const c of par.cand ?? []) {
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
        });
      }
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

/** Percentual de seções totalizadas por município, a partir do arquivo de abrangência (1 requisição por UF). */
export async function getAbrangencia(eleicao, uf) {
  const raw = await fetchJson(
    `${TSE_BASE}/${CICLO}/${eleicao}/dados/${uf}/${uf}-e${pad(eleicao, 6)}-ab.json`, 30_000, await fimDaVotacao(eleicao),
  );
  const out = {};
  for (const a of raw?.abr ?? []) {
    if (a.tpabr !== 'mun') continue;
    const pctApurado = DEMO ? Math.round(demoProgresso(`mu:${a.cdabr}`) * 10000) / 100 : pct(a.s?.pst);
    out[a.cdabr] = { pctApurado, lider: null };
  }
  return out;
}
