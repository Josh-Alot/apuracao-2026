// Arquivo próprio dos resultados finais (pasta arquivo/, gerada por `npm run arquivar`).
//
// Formato compacto: 1 arquivo .json.gz por eleição + cargo + UF ("unidade"), com o JSON da UF exatamente
// como o TSE publicou (o "modelo": nomes, partidos, vices, situação, QE) e, para cada município e zona,
// só o que muda de uma região para outra — votos por candidato, totais por agremiação/partido e os blocos
// s/e/v. `expandir()` remonta o JSON do TSE de qualquer região; o script de arquivamento confere cada
// região remontada contra o original (só o `pvapn`, que o app não usa, fica de fora).
//
// O servidor usa o arquivo quando o TSE falha, pausa ou não tem mais o arquivo, e sempre com ARQUIVO=1
// ou quando a eleição está toda final no manifesto (`eleicaoFinal`).

import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { SIMULACAO, RAIZ_SIMULACAO } from './simulacao.mjs';

const gunzip = promisify(zlib.gunzip);

export const FORMATO = 1;
export const RAIZ_ARQUIVO = new URL('../arquivo/', import.meta.url);

// ---------- codificação (usada pelo script e pelo servidor) ----------

const AUSENTES = '~x'; // chaves do modelo que a região não tem
const BLOCOS = ['s', 'e', 'v'];
const IGNORAR_TOPO = new Set(['carg', ...BLOCOS]);
const IGNORAR_CARG = new Set(['agr']);
const IGNORAR_AGR = new Set(['par']);
const IGNORAR_PAR = new Set(['cand']);
const IGNORAR_CAND = new Set(['vap', 'pvap', 'pvapn']);

const igual = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Só as chaves de `obj` que diferem de `base` (e a lista das que faltam). */
function diferenca(base, obj, ignorar) {
  const d = {};
  for (const k of Object.keys(obj)) if (!ignorar.has(k) && !igual(obj[k], base[k])) d[k] = obj[k];
  const faltam = Object.keys(base).filter((k) => !ignorar.has(k) && !(k in obj));
  if (faltam.length) d[AUSENTES] = faltam;
  return d;
}

function aplicar(base, d = {}, ignorar) {
  const out = {};
  const faltam = new Set(d[AUSENTES]);
  for (const k of Object.keys(base)) if (!ignorar.has(k) && !faltam.has(k)) out[k] = base[k];
  for (const k of Object.keys(d)) if (k !== AUSENTES) out[k] = d[k];
  return out;
}

const vazio = (o) => !o || !Object.keys(o).length;

// Números do TSE vêm como string: guarda como número quando a volta é exata.
const num = (s) => (typeof s === 'string' && /^(0|[1-9]\d{0,14})$/.test(s) ? Number(s) : s);
const str = (x) => (typeof x === 'number' ? String(x) : x);

/** % do TSE: 2 casas, vírgula; quem tem voto e daria 0,00 aparece como 0,01. Exceções vão em `pv`. */
function pvapCalculado(vap, vv) {
  if (!vv || !vap) return '0,00';
  const p = ((vap * 100) / vv).toFixed(2);
  return (p === '0.00' ? '0.01' : p).replace('.', ',');
}

/** Estrutura derivada do modelo: ordem dos candidatos e chaves dos blocos s/e/v. */
function indice(modelo) {
  const cands = []; // { a, p, c } = posição em agr / par / cand
  const pos = new Map(); // sqcand → índice em cands
  modelo.carg[0].agr.forEach((agr, a) => agr.par.forEach((par, p) => par.cand.forEach((c, k) => {
    pos.set(c.sqcand, cands.length);
    cands.push({ a, p, c: k });
  })));
  const chaves = Object.fromEntries(BLOCOS.map((b) => [b, Object.keys(modelo[b] ?? {})]));
  return { cands, pos, chaves };
}

/** Codifica uma região (JSON do TSE de município ou zona) em relação ao modelo da unidade. */
export function codificarRegiao(modelo, idx, raw) {
  const r = {};
  const t = diferenca(modelo, raw, IGNORAR_TOPO);
  if (!vazio(t)) r.t = t;
  for (const b of BLOCOS) {
    if (!raw[b]) { r[b] = null; continue; }
    r[b] = idx.chaves[b].map((k) => (k in raw[b] ? num(raw[b][k]) : null));
    const extra = Object.keys(raw[b]).filter((k) => !idx.chaves[b].includes(k));
    if (extra.length) (r.x ??= {})[b] = Object.fromEntries(extra.map((k) => [k, raw[b][k]]));
  }

  const cm = modelo.carg[0];
  const cr = raw.carg?.[0];
  if (raw.carg?.length !== 1 || !cr) throw new Error(`carg inesperado em ${raw.cdabr}`);
  const c = diferenca(cm, cr, IGNORAR_CARG);
  if (!vazio(c)) r.c = c;

  const agrPorN = new Map(cr.agr.map((a) => [a.n, a]));
  if (agrPorN.size !== cr.agr.length || cr.agr.some((a) => !cm.agr.some((m) => m.n === a.n))) {
    throw new Error(`agremiações diferentes do modelo em ${raw.cdabr}`);
  }
  const vv = Number(raw.v?.vv) || 0;
  r.a = [];
  r.p = [];
  r.vap = new Array(idx.cands.length).fill(null);
  let vistos = 0;
  cm.agr.forEach((ma) => {
    const ra = agrPorN.get(ma.n);
    r.a.push(ra ? diferenca(ma, ra, IGNORAR_AGR) : null);
    const parPorN = new Map((ra?.par ?? []).map((p) => [p.n, p]));
    if (ra && ra.par.some((p) => !ma.par.some((m) => m.n === p.n))) throw new Error(`partido fora do modelo em ${raw.cdabr}`);
    ma.par.forEach((mp) => {
      const rp = parPorN.get(mp.n);
      r.p.push(rp ? diferenca(mp, rp, IGNORAR_PAR) : null);
      for (const cand of rp?.cand ?? []) {
        const i = idx.pos.get(cand.sqcand);
        const m = i === undefined ? null : idx.cands[i];
        if (!m || cm.agr[m.a] !== ma || ma.par[m.p] !== mp) throw new Error(`candidato ${cand.sqcand} fora do modelo em ${raw.cdabr}`);
        vistos++;
        r.vap[i] = num(cand.vap);
        if (cand.pvap !== pvapCalculado(Number(cand.vap), vv)) (r.pv ??= {})[i] = cand.pvap;
        const d = diferenca(mp.cand[m.c], cand, IGNORAR_CAND);
        if (!vazio(d)) (r.cx ??= {})[i] = d;
      }
    });
  });
  if (vistos !== r.vap.filter((v) => v !== null).length) throw new Error(`candidato repetido em ${raw.cdabr}`);
  return r;
}

/** Remonta o JSON do TSE de uma região. */
function decodificarRegiao(modelo, idx, r) {
  const raw = aplicar(modelo, r.t, IGNORAR_TOPO);
  for (const b of BLOCOS) {
    if (r[b] === null) continue;
    const o = {};
    idx.chaves[b].forEach((k, i) => { if (r[b][i] !== null) o[k] = str(r[b][i]); });
    Object.assign(o, r.x?.[b]);
    raw[b] = o;
  }
  const cm = modelo.carg[0];
  const carg = aplicar(cm, r.c, IGNORAR_CARG);
  const vv = Number(raw.v?.vv) || 0;
  let p = 0;
  carg.agr = [];
  const porPar = new Map(); // "a/p" → lista de candidatos
  idx.cands.forEach((m, i) => {
    if (r.vap[i] === null) return;
    const mc = cm.agr[m.a].par[m.p].cand[m.c];
    const vap = str(r.vap[i]);
    const c = { ...aplicar(mc, r.cx?.[i], IGNORAR_CAND), vap, pvap: r.pv?.[i] ?? pvapCalculado(Number(vap), vv) };
    const chave = `${m.a}/${m.p}`;
    if (!porPar.has(chave)) porPar.set(chave, []);
    porPar.get(chave).push(c);
  });
  cm.agr.forEach((ma, a) => {
    const da = r.a[a];
    const agr = da ? aplicar(ma, da, IGNORAR_AGR) : null;
    if (agr) agr.par = [];
    ma.par.forEach((mp, k) => {
      const dp = r.p[p++];
      if (!agr || !dp) return;
      const par = aplicar(mp, dp, IGNORAR_PAR);
      // Como nos arquivos do TSE: candidatos do partido do mais ao menos votado.
      par.cand = (porPar.get(`${a}/${k}`) ?? []).sort((x, y) => Number(y.vap) - Number(x.vap));
      agr.par.push(par);
    });
    if (agr) carg.agr.push(agr);
  });
  raw.carg = [carg];
  return raw;
}

/**
 * Forma canônica para conferir: sem pvapn e sem ordem — o TSE ordena agremiações, partidos e
 * candidatos de um jeito em cada região (o app reordena tudo), e a remontagem segue o modelo.
 */
export function canonico(raw) {
  const por = (campo) => (a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0);
  return JSON.stringify(raw, function (k, v) {
    if (k === 'pvapn' && this && 'sqcand' in this) return undefined;
    if (k === 'cand' && Array.isArray(v)) return [...v].sort(por('sqcand'));
    if ((k === 'agr' || k === 'par') && Array.isArray(v)) return [...v].sort(por('n'));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((c) => [c, v[c]]));
    }
    return v;
  });
}

/** Unidade vazia: só o modelo (JSON da UF, ou do Brasil para o Presidente). */
export function novaUnidade(abr, modelo) {
  return { formato: FORMATO, abr, modelo, regioes: {}, faltando: [] };
}

const indices = new WeakMap();
function indiceDe(u) {
  if (!indices.has(u)) indices.set(u, indice(u.modelo));
  return indices.get(u);
}

export function adicionarRegiao(u, abr, raw) {
  const r = codificarRegiao(u.modelo, indiceDe(u), raw);
  const volta = decodificarRegiao(u.modelo, indiceDe(u), JSON.parse(JSON.stringify(r)));
  if (canonico(volta) !== canonico(raw)) throw new Error(`a região ${abr} não volta igual ao original do TSE`);
  u.regioes[abr] = r;
}

/** JSON do TSE de uma região da unidade (o próprio modelo para a UF), ou null se não houver. */
export function expandir(u, abr) {
  if (abr === u.abr) return u.modelo;
  const r = u.regioes[abr];
  return r ? decodificarRegiao(u.modelo, indiceDe(u), r) : null;
}

/**
 * UF marcada como final pelo TSE (tf = "s") e cada região final ou com todas as seções totalizadas. Em várias
 * UFs de deputados (2026) o TSE fechou a UF e não gerou de novo os municípios/zonas, que ficaram com tf = "n"
 * para sempre — com 100% das seções e somando exatamente os votos da UF final.
 */
export function unidadeFinal(u) {
  if (u.modelo.tf !== 's') return false;
  return Object.keys(u.regioes).every((abr) => {
    const r = expandir(u, abr);
    return r.tf === 's' || (r.s?.ts !== undefined && r.s.st === r.s.ts);
  });
}

// ---------- leitura no servidor ----------

export const ARQUIVO_FORCADO = process.env.ARQUIVO === '1';
// Unidades abertas ficam em memória (LRU pelo tamanho do texto descompactado).
const MEMORIA_MAX = Number(process.env.ARQUIVO_MB || 16) * 1024 * 1024;
const abertos = new Map(); // caminho → { dado, bytes }
let abertosBytes = 0;
const abrindo = new Map(); // caminho → Promise

let pastas = null; // eleição → URL da pasta; eleições com todas as unidades finais (e a data); ele-c.json mais recente
function mapearPastas() {
  if (pastas) return pastas;
  pastas = { eleicao: new Map(), finais: new Set(), datas: new Map(), config: null };
  // A simulação do 2º turno (SIMULACAO_2TURNO=1) entra como mais uma pasta, toda final: sai só dela.
  const turnos = [];
  for (const raiz of SIMULACAO ? [RAIZ_ARQUIVO, RAIZ_SIMULACAO] : [RAIZ_ARQUIVO]) {
    try {
      for (const d of fs.readdirSync(raiz).filter((x) => /-\d+turno$/.test(x)).sort()) turnos.push([d, raiz]);
    } catch { /* pasta ausente */ }
  }
  for (const [t, raiz] of turnos) {
    const base = new URL(`${t}/`, raiz);
    for (const e of fs.readdirSync(base)) if (/^\d+$/.test(e)) pastas.eleicao.set(`${t.split('-')[0]}/${e}`, new URL(`${e}/`, base));
    let unidades = {};
    try { unidades = JSON.parse(fs.readFileSync(new URL('manifesto.json', base), 'utf8')).unidades ?? {}; } catch {}
    const porEleicao = Map.groupBy(Object.entries(unidades), ([k]) => k.split('/')[0]);
    for (const [e, us] of porEleicao) {
      if (!us.every(([, u]) => u.final)) continue;
      pastas.finais.add(`${t.split('-')[0]}/${e}`);
      // Data do resultado final (a geração mais recente no TSE, "dd/mm/aaaa hh:mm:ss"), para o lastmod do
      // sitemap; a simulação não tem data verdadeira.
      const datas = us.map(([, u]) => /^(\d\d)\/(\d\d)\/(\d{4})/.exec(u.tse ?? '')).filter(Boolean).map((m) => `${m[3]}-${m[2]}-${m[1]}`);
      if (raiz === RAIZ_ARQUIVO && datas.length) pastas.datas.set(`${t.split('-')[0]}/${e}`, datas.sort().at(-1));
    }
    if (fs.existsSync(new URL('ele-c.json', base))) pastas.config = new URL('ele-c.json', base);
  }
  return pastas;
}

async function abrir(arquivo) {
  const chave = arquivo.href;
  const hit = abertos.get(chave);
  if (hit) {
    abertos.delete(chave);
    abertos.set(chave, hit);
    return hit.dado;
  }
  if (abrindo.has(chave)) return abrindo.get(chave);
  const p = (async () => {
    let buf;
    try { buf = await readFile(arquivo); } catch { return null; }
    const texto = (arquivo.pathname.endsWith('.gz') ? await gunzip(buf) : buf).toString('utf8');
    const dado = JSON.parse(texto);
    abertos.set(chave, { dado, bytes: texto.length });
    abertosBytes += texto.length;
    for (const [c, e] of abertos) { // mantém ao menos a recém-aberta
      if (abertosBytes <= MEMORIA_MAX || c === chave) break;
      abertos.delete(c);
      abertosBytes -= e.bytes;
    }
    return dado;
  })().finally(() => abrindo.delete(chave));
  abrindo.set(chave, p);
  return p;
}

/**
 * A URL do TSE é de uma eleição arquivada com todas as unidades finais no manifesto? Então o arquivo
 * é a fonte dela, mesmo sem ARQUIVO=1: o resultado não muda mais e não há por que consultar o TSE.
 */
export function eleicaoFinal(url, base) {
  const m = url.startsWith(base) && /^\/([a-z]+\d+)\/(\d+)\//.exec(url.slice(base.length));
  return Boolean(m && mapearPastas().finais.has(`${m[1]}/${m[2]}`));
}

/** Data (aaaa-mm-dd) do resultado final de uma eleição toda final no arquivo, ou null. */
export const dataFinal = (ciclo, eleicao) => mapearPastas().datas.get(`${ciclo}/${eleicao}`) ?? null;

let usados = 0;
export const estadoArquivo = () => ({
  forcado: ARQUIVO_FORCADO, finais: [...mapearPastas().finais], usados, abertos: abertos.size, abertosMB: Math.round(abertosBytes / 2 ** 20),
});

/**
 * JSON arquivado para uma URL do TSE (`base` = TSE_BASE), ou undefined se o arquivo não a cobre.
 * Cobre a configuração geral, a lista de municípios, a abrangência e os resultados (-u.json).
 */
export async function doArquivo(url, base) {
  if (!url.startsWith(base)) return undefined;
  const caminho = url.slice(base.length);
  const { eleicao, config } = mapearPastas();
  let dado;
  if (caminho === '/comum/config/ele-c.json') {
    dado = config ? await abrir(config) : null;
  } else {
    const m = /^\/([a-z]+\d+)\/(\d+)\/(?:config\/mun-e\d+-cm\.json|dados\/([a-z]{2})\/(.+)\.json)$/.exec(caminho);
    const pasta = m && eleicao.get(`${m[1]}/${m[2]}`);
    if (!pasta) return undefined;
    const [, , , uf, nome] = m;
    if (!uf) {
      dado = await abrir(new URL('mun-cm.json.gz', pasta));
    } else if (nome === `${uf}-e${m[2].padStart(6, '0')}-ab`) {
      dado = await abrir(new URL(`${uf}-ab.json.gz`, pasta));
    } else {
      const r = /^([a-z]{2}(?:\d{5})?(?:-z\d{4})?)-c(\d{4})-e\d{6}-u$/.exec(nome);
      if (!r) return undefined;
      // A UF sozinha vem do arquivo pequeno ao lado da unidade: a busca lê as ~140 UFs e abrir as unidades
      // inteiras (até 7 MB de JSON cada, com todos os municípios e zonas) estourava os 512 MB do Render.
      if (r[1] === uf) dado = await abrir(new URL(`${uf}-c${r[2]}-uf.json.gz`, pasta));
      if (dado == null) {
        const u = await abrir(new URL(`${uf}-c${r[2]}.json.gz`, pasta));
        dado = u ? expandir(u, r[1]) : null;
      }
    }
  }
  if (dado == null) return undefined;
  usados++;
  return dado;
}
