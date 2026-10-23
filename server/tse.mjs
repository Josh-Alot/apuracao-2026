// Cliente da API pública de divulgação de resultados do TSE (resultados.tse.jus.br).
// O TSE não envia cabeçalhos CORS, por isso todo acesso passa por este servidor.
//
// Fachada: configuração, municípios e resultados. As peças ficam em server/tse/:
//   urls.mjs      endereços dos arquivos e as UFs
//   cache.mjs     cache em memória (LRU por tamanho, validadores HTTP, resultado normalizado junto)
//   fila.mjs      fila com taxa e prioridade, pausa após 429
//   fonte.mjs     fetchJson: cache + fila + arquivo próprio
//   apuracao.mjs  regras puras: normalizar, situação, matematicamente, QE, chapas, resumo

import { readFile } from 'node:fs/promises';
import { applyDemo, demoProgresso } from './demo.mjs';
import { ARQUIVO_FORCADO, doArquivo, eleicaoFinal } from './arquivo.mjs';
import { eleicoesSimuladas, mesclarConfig } from './simulacao.mjs';
import { espiar, estadoCache, normalizadoEmCache } from './tse/cache.mjs';
import { PRIORIDADE, estadoDaFila } from './tse/fila.mjs';
import { CONFIG_URL, fetchJson } from './tse/fonte.mjs';
import { escopoDaDisputa, normalizar, pct } from './tse/apuracao.mjs';
import { CICLO, TSE_BASE, UFS, pad, resultadoUrl } from './tse/urls.mjs';
/** @import { CargoTse, ConfigTse, MapaDados, Municipios, ParamsResultado, Resultado } from '../compartilhado/api.mjs' */

export { CICLO, TSE_BASE, UFS, fotoUrl, resultadoUrl } from './tse/urls.mjs';
export { PRIORIDADE } from './tse/fila.mjs';
export { ErroTse, fetchJson, mapLimit } from './tse/fonte.mjs';
export { resumo } from './tse/apuracao.mjs';

/** Situação da fila e do cache (para o log e para /api/saude). */
export const estadoFila = () => ({ ...estadoDaFila(), ...estadoCache() });

const DEMO = process.env.DEMO === '1';

/**
 * Horário de votação: desde 2022 é unificado em todo o país, das 8h às 17h de Brasília.
 * ENCERRAMENTO (ISO 8601) sobrescreve o fim da votação para testes — ex.: ENCERRAMENTO=2026-10-04T18:00:00-03:00.
 * No modo demo e na simulação do 2º turno o aviso fica desligado (os números são simulados), a menos que
 * ENCERRAMENTO seja definido.
 */
function horarios(ddmmaaaa, simulado) {
  const [d, m, a] = ddmmaaaa.split('/');
  const dia = `${a}-${m}-${d}`;
  if (process.env.ENCERRAMENTO) {
    return { abertura: `${dia}T08:00:00-03:00`, encerramento: process.env.ENCERRAMENTO };
  }
  if (DEMO || simulado) return { abertura: null, encerramento: null };
  return { abertura: `${dia}T08:00:00-03:00`, encerramento: `${dia}T17:00:00-03:00` };
}

// Cargos que o app exibe (Conselheiro Distrital e consultas populares ficam de fora).
const CARGOS_SUPORTADOS = new Set(['1', '3', '5', '6', '7', '8']);
const TIPOS_ELEICAO = new Set(['8', '1']); // 8 = federal, 1 = estadual

// ---------- configuração ----------

// Cópia do ele-c.json guardada no repositório: sem ela, um 429 logo após reiniciar (cache vazio)
// derrubaria todas as rotas, já que todas dependem da configuração.
const CONFIG_RESERVA = new URL('../dados/ele-c.json', import.meta.url);
let configReserva = null;

async function configTse() {
  try {
    const raw = await fetchJson(CONFIG_URL, 5 * 60_000);
    if (raw) return mesclarConfig(raw);
  } catch { /* usa a cópia local abaixo */ }
  configReserva ??= readFile(CONFIG_RESERVA, 'utf8').then(JSON.parse);
  return mesclarConfig(await configReserva);
}

// getConfig() é chamada em quase toda requisição: só remonta quando o ele-c.json muda.
let configMemo = { raw: null, cfg: null };

/** @returns {Promise<ConfigTse>} */
export async function getConfig() {
  const raw = await configTse();
  if (configMemo.raw === raw) return configMemo.cfg;
  /** @type {CargoTse[]} */
  const cargos = [];
  const simuladas = eleicoesSimuladas();
  // 2º turno → eleição do 1º turno (`cdt2`), para comparar os dois turnos (mapa: quem "virou").
  const primeiroDe = new Map();
  for (const pl of raw.pl) for (const e of pl.e) if (e.cdt2) primeiroDe.set(e.cdt2, e.cd);
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
              ...horarios(pl.dt, simuladas.has(e.cd)),
              simulado: simuladas.has(e.cd),
              primeiroTurno: primeiroDe.has(e.cd) ? `${primeiroDe.get(e.cd)}-${cp.cd}` : null,
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

/** @returns {Promise<Municipios | null>} */
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
 * Até o fechamento das urnas o TSE só publica arquivos zerados (nem o exterior é divulgado antes).
 * Então cada arquivo de resultado é buscado no máximo uma vez e guardado até lá — a consulta
 * recorrente ao TSE só começa às 17h de Brasília. Devolve 0 quando a apuração já abriu (ou no demo).
 */
async function fimDaVotacao(eleicao) {
  const fim = (await getConfig()).cargos.find((c) => c.eleicao === eleicao)?.encerramento;
  const ms = fim ? Date.parse(fim) : 0;
  return ms > Date.now() ? ms : 0;
}

/**
 * @param {ParamsResultado} params
 * @returns {Promise<Resultado | null>}
 */
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
 * Resultado normalizado de um JSON do TSE (o da demo muda com o tempo; os demais ficam em cache junto do JSON).
 * @param {ParamsResultado} params
 * @returns {Resultado | null}
 */
function deRaw(raw, params, url) {
  if (!raw || !raw.carg?.length) return null;
  if (DEMO) return normalizar(applyDemo(raw), params); // a demo muda com o tempo
  return normalizadoEmCache(url, raw, (r) => normalizar(r, params));
}

/**
 * Resultado sem nenhuma consulta ao TSE (meta tags e sitemap, que o Googlebot pede às dezenas de milhares):
 * o que estiver no cache em memória, mesmo vencido, ou, em eleição toda final no arquivo próprio, o arquivo
 * (lido direto, sem entrar no cache do TSE). `arquivo: false` dispensa também o arquivo (unidades grandes,
 * como as de deputado por município). null se não houver.
 *
 * @param {ParamsResultado} params
 * @returns {Promise<Resultado | null>}
 */
export async function getResultadoSemTse(params, { arquivo = true } = {}) {
  const url = resultadoUrl(params);
  const hit = espiar(url);
  if (hit) return deRaw(hit.data, params, url);
  if (!arquivo || !(ARQUIVO_FORCADO || eleicaoFinal(url, TSE_BASE))) return null;
  const raw = await doArquivo(url, TSE_BASE).catch(() => undefined);
  return raw ? deRaw(raw, params, url) : null;
}

/** Todas as seções totalizadas: o líder não muda mais (o mapa pode renovar bem devagar). */
const apuracaoCompleta = (raw) => !DEMO && pct(raw?.s?.pst) >= 100;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Vários resultados de uma vez sem prender a resposta na fila (mapas e busca): espera no máximo
 * `esperaMs` pelo que precisa ser consultado e devolve o que houver — o dado em cache (mesmo
 * vencido), null se o TSE não tem o arquivo, ou undefined se ainda não chegou (segue na fila e
 * entra na próxima atualização).
 *
 * @param {ParamsResultado[]} lista
 * @returns {Promise<(Resultado | null | undefined)[]>}
 */
export async function getResultadosRapidos(lista, ttlMs, prioridade, { esperaMs = 4_000, ttlCompletoMs = ttlMs } = {}) {
  const fim = await fimDaVotacao(lista[0]?.eleicao);
  const urls = lista.map(resultadoUrl);
  const pendentes = urls.map((url) => {
    const ttl = apuracaoCompleta(espiar(url)?.data) ? Math.max(ttlMs, ttlCompletoMs) : ttlMs;
    return fetchJson(url, ttl, fim, prioridade).catch(() => undefined);
  });
  await Promise.race([Promise.allSettled(pendentes), dormir(esperaMs)]);
  return lista.map((params, i) => {
    const hit = espiar(urls[i]);
    return hit ? deRaw(hit.data, params, urls[i]) : undefined;
  });
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

/**
 * Percentual de seções totalizadas por município, a partir do arquivo de abrangência (1 requisição por UF).
 * @returns {Promise<MapaDados>}
 */
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
