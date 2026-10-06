// `npm run arquivar`: baixa os resultados finais de todos os cargos (Brasil, UFs, municípios e zonas)
// e guarda em arquivo/<ciclo>-<turno>turno/ no formato compacto de server/arquivo.mjs.
//
// Retomável: cada unidade (eleição + cargo + UF) é gravada ao terminar, e uma unidade já final
// (tf = "s" em todas as regiões) é pulada. Rode de novo depois que o TSE fechar a totalização dos
// deputados (recursos e sub judice podem levar dias) — só o que ainda não era final é baixado.
//
// Opções: --turno 1 · --uf sp,mg · --cargo 6,7 · --forcar (baixa de novo mesmo o que já é final)
//         --rps 8 (consultas por segundo ao TSE) · --conc 8 (consultas simultâneas)

import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { TSE_BASE, CICLO, getConfig } from '../tse.mjs';
import { RAIZ_ARQUIVO, novaUnidade, adicionarRegiao, unidadeFinal } from '../arquivo.mjs';

const { values: op } = parseArgs({
  options: {
    turno: { type: 'string', default: '1' },
    uf: { type: 'string' },
    cargo: { type: 'string' },
    forcar: { type: 'boolean', default: false },
    rps: { type: 'string', default: '8' },
    conc: { type: 'string', default: '8' },
  },
});
const lista = (s) => (s ? new Set(s.toLowerCase().split(',')) : null);
const SO_UFS = lista(op.uf);
const SO_CARGOS = lista(op.cargo);
const RPS_MAX = Number(op.rps);
const CONC = Number(op.conc);

const PASTA = new URL(`${CICLO}-${op.turno}turno/`, RAIZ_ARQUIVO);
const MANIFESTO = new URL('manifesto.json', PASTA);
const pad = (s, n) => String(s).padStart(n, '0');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- consultas ao TSE: taxa máxima, recua no 429 e tenta de novo em falhas ----------

let rps = RPS_MAX;
let proximo = 0;
let ultimo429 = 0;
let consultas = 0;
let bytesBaixados = 0;

async function vez() {
  const agora = Date.now();
  const t = Math.max(agora, proximo);
  proximo = t + 1000 / rps;
  if (t > agora) await dormir(t - agora);
}

/** JSON do TSE, ou null se o arquivo não existe (404/403). */
async function baixar(url) {
  for (let tentativa = 1; ; tentativa++) {
    await vez();
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': 'apuracao-2026/0.1 (arquivamento)' } });
    } catch (err) {
      if (tentativa >= 8) throw err;
      await dormir(Math.min(60_000, 1000 * 2 ** tentativa));
      continue;
    }
    consultas++;
    if (res.status === 404 || res.status === 403) return null;
    if (res.status === 429) {
      ultimo429 = Date.now();
      rps = Math.max(0.5, rps / 2);
      const espera = Math.max(5_000, Number(res.headers.get('retry-after')) * 1000 || 0);
      proximo = Date.now() + espera;
      console.warn(`  TSE respondeu 429: pausa de ${espera / 1000} s, taxa agora ${rps.toFixed(1)}/s`);
      if (tentativa >= 20) throw new Error(`429 persistente em ${url}`);
      continue;
    }
    if (!res.ok) {
      if (tentativa >= 8) throw new Error(`HTTP ${res.status} em ${url}`);
      await dormir(Math.min(60_000, 1000 * 2 ** tentativa));
      continue;
    }
    const texto = await res.text();
    bytesBaixados += texto.length;
    if (rps < RPS_MAX && Date.now() - ultimo429 > 30_000) rps = Math.min(RPS_MAX, rps + 0.1);
    return JSON.parse(texto);
  }
}

async function emParalelo(itens, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, itens.length) }, async () => {
    while (i < itens.length) await fn(itens[i++]);
  }));
}

// ---------- gravação ----------

// gzip do Node não grava data no cabeçalho: o mesmo conteúdo gera os mesmos bytes (git não vê mudança).
async function gravar(nome, dado, { gz = true } = {}) {
  const destino = new URL(nome, PASTA);
  await fs.mkdir(new URL('.', destino), { recursive: true });
  const texto = JSON.stringify(dado);
  const buf = gz ? zlib.gzipSync(texto, { level: 9 }) : Buffer.from(`${JSON.stringify(dado, null, 1)}\n`);
  const tmp = new URL(`${nome}.tmp`, PASTA);
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, destino);
  return buf.length;
}

async function lerManifesto() {
  try { return JSON.parse(await fs.readFile(MANIFESTO, 'utf8')); } catch {
    return { ciclo: CICLO, turno: Number(op.turno), fonte: TSE_BASE, unidades: {} };
  }
}

const ordenado = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

// ---------- principal ----------

const mb = (b) => `${(b / 2 ** 20).toFixed(1)} MB`;
const tempo = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60), 2)}` : `${Math.floor(s / 60)}min${pad(s % 60, 2)}`;
};

const inicio = Date.now();
const manifesto = await lerManifesto();
const cfg = await getConfig();
const cargos = cfg.cargos.filter((c) => String(c.turno) === op.turno && (!SO_CARGOS || SO_CARGOS.has(c.cargo)));
if (!cargos.length) {
  console.error(`Nenhum cargo do ${op.turno}º turno no ele-c.json do TSE.`);
  process.exit(1);
}

// Configuração geral e, por eleição, municípios/zonas e abrangência por UF.
const eleC = await baixar(`${TSE_BASE}/comum/config/ele-c.json`);
await gravar('ele-c.json', eleC, { gz: false });
const municipios = {};
for (const eleicao of new Set(cargos.map((c) => c.eleicao))) {
  const cm = await baixar(`${TSE_BASE}/${CICLO}/${eleicao}/config/mun-e${pad(eleicao, 6)}-cm.json`);
  await gravar(`${eleicao}/mun-cm.json.gz`, cm);
  municipios[eleicao] = Object.fromEntries(cm.abr.map((a) => [a.cd.toLowerCase(), a.mu]));
  const ufs = new Set(cargos.filter((c) => c.eleicao === eleicao).flatMap((c) => c.ufs));
  // "br": % de seções por UF, usado para saber se a apuração da eleição está encerrada.
  for (const uf of ['br', ...ufs]) {
    if (SO_UFS && !SO_UFS.has(uf)) continue;
    const ab = await baixar(`${TSE_BASE}/${CICLO}/${eleicao}/dados/${uf}/${uf}-e${pad(eleicao, 6)}-ab.json`);
    if (ab) await gravar(`${eleicao}/${uf}-ab.json.gz`, ab);
  }
}

// Unidades: Presidente tem o Brasil e cada UF (com o exterior); os demais cargos, cada UF.
const unidades = [];
for (const c of cargos) {
  for (const uf of c.cargo === '1' ? ['br', ...c.ufs] : c.ufs) {
    if (SO_UFS && !SO_UFS.has(uf) && !(uf === 'br' && SO_UFS.has('br'))) continue;
    const chave = `${c.eleicao}/${uf}-c${pad(c.cargo, 4)}`;
    const regioes = uf === 'br' ? [] : (municipios[c.eleicao][uf] ?? []).flatMap((m) => [
      `${uf}${m.cd}`, ...m.z.map((z) => `${uf}${m.cd}-z${pad(z, 4)}`),
    ]);
    if (!op.forcar && manifesto.unidades[chave]?.final) continue;
    unidades.push({ c, uf, chave, regioes });
  }
}
const total = unidades.reduce((t, u) => t + 1 + u.regioes.length, 0);
console.log(`${unidades.length} unidades a baixar (${total} arquivos do TSE) em ${PASTA.pathname}`);

let feitos = 0;
const falhas = [];
for (const { c, uf, chave, regioes } of unidades) {
  const t0 = Date.now();
  const url = (abr) => `${TSE_BASE}/${CICLO}/${c.eleicao}/dados/${uf}/${abr}-c${pad(c.cargo, 4)}-e${pad(c.eleicao, 6)}-u.json`;
  try {
    const modelo = await baixar(url(uf));
    feitos++;
    if (!modelo) {
      console.log(`${chave} ${c.nome}: sem arquivo no TSE, pulando`);
      feitos += regioes.length;
      continue;
    }
    const u = novaUnidade(uf, modelo);
    let ultimoAviso = Date.now();
    await emParalelo(regioes, async (abr) => {
      const raw = await baixar(url(abr));
      feitos++;
      if (raw) adicionarRegiao(u, abr, raw);
      else u.faltando.push(abr);
      if (Date.now() - ultimoAviso > 30_000) {
        ultimoAviso = Date.now();
        const passou = Date.now() - inicio;
        console.log(`  … ${feitos}/${total} (${((100 * feitos) / total).toFixed(1)}%), ${rps.toFixed(1)}/s, faltam ~${tempo((passou / feitos) * (total - feitos))}`);
      }
    });
    u.faltando.sort();
    u.regioes = ordenado(u.regioes);
    const bytes = await gravar(`${chave}.json.gz`, u);
    await gravar(`${chave}-uf.json.gz`, modelo); // só a UF, para o servidor não abrir a unidade inteira
    const final = unidadeFinal(u);
    manifesto.unidades[chave] = {
      cargo: c.nome, final, regioes: Object.keys(u.regioes).length, faltando: u.faltando.length,
      bytes, tse: `${modelo.dg} ${modelo.hg}`, arquivado: new Date().toISOString(),
    };
    manifesto.unidades = ordenado(manifesto.unidades);
    await gravar('manifesto.json', manifesto, { gz: false });
    console.log(`${chave} ${c.nome}: ${Object.keys(u.regioes).length} regiões${u.faltando.length ? ` (${u.faltando.length} sem arquivo)` : ''}, ${mb(bytes)}, ${final ? 'final' : 'AINDA NÃO FINAL'}, ${tempo(Date.now() - t0)}`);
  } catch (err) {
    falhas.push(chave);
    console.error(`${chave} ${c.nome}: FALHOU — ${err.message}`);
  }
}

const tamanho = Object.values(manifesto.unidades).reduce((t, u) => t + u.bytes, 0);
const pendentes = Object.entries(manifesto.unidades).filter(([, u]) => !u.final).map(([k]) => k);
console.log(`\nFim em ${tempo(Date.now() - inicio)}: ${consultas} consultas, ${mb(bytesBaixados)} baixados; arquivo com ${mb(tamanho)}.`);
if (pendentes.length) console.log(`Ainda não finais (rode de novo depois): ${pendentes.join(', ')}`);
if (falhas.length) {
  console.error(`Falharam: ${falhas.join(', ')}`);
  process.exitCode = 1;
}
process.exit();
