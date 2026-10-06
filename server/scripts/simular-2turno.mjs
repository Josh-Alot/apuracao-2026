// `npm run simular-2turno`: gera uma simulação do 2º turno de 2026 enquanto o TSE não publica os dados.
//
// Base dos votos: o 2º turno de 2022 (Portal de Dados Abertos do TSE — a API de resultados não tem mais
// 2022), por zona eleitoral: comparecimento, brancos, nulos e votos válidos de cada partido. Em cada zona
// de 2026, o eleitorado e as seções vêm do 1º turno de 2026 (arquivo/), e as taxas da mesma zona em 2022
// (ou do município/UF, se a zona não existia) viram os votos dos candidatos que foram ao 2º turno de 2026.
// Município, UF e Brasil são somas das zonas, como no TSE.
//
// Grava em simulacao/ele2026-2turno/ no formato do arquivo próprio (server/arquivo.mjs), mais o
// simulacao.json com o pleito que o servidor acrescenta ao ele-c.json do TSE. O servidor só usa a
// simulação com SIMULACAO_2TURNO=1. Usa o `unzip` do sistema.

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { novaUnidade, adicionarRegiao, expandir, RAIZ_ARQUIVO } from '../arquivo.mjs';
import { RAIZ_SIMULACAO } from '../simulacao.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = path.join(ROOT, '.cache', 'dados-abertos');
const CDN = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
const PRIMEIRO = new URL('ele2026-1turno/', RAIZ_ARQUIVO);
const PASTA = new URL('ele2026-2turno/', RAIZ_SIMULACAO);

const DATA = '25/10/2026';
const HORA = '21:40:12';
// Eleições do 2º turno: o `cdt2` das eleições do 1º turno no ele-c.json do TSE.
const ELEICOES = {
  6258: { primeiro: '6257', cargo: '1', tp: '8', nm: 'Eleição Ordinária Federal - 2026 2º Turno', ds: 'Presidente' },
  6260: { primeiro: '6259', cargo: '3', tp: '1', nm: 'Eleição Ordinária Estadual - 2026 2º Turno', ds: 'Governador' },
};

// De quem é cada votação de 2022 em 2026: partido em 2022 → número do candidato em 2026, alinhando os
// campos políticos. Onde houve 2º turno para governador nas duas eleições (AM, ES), a base é o governador
// de 2022; nas demais UFs, o Presidente de 2022 naquela UF.
const PRESIDENTE = { PT: '13', PL: '22' }; // Lula (PT) e Flávio Bolsonaro (PL)
const GOVERNADOR = {
  ac: { base: '1', partidos: { PL: '11', PT: '10' } }, // Mailza (PP, com o PL) × Alan Rick (Republicanos)
  am: { base: '3', partidos: { MDB: '55', 'UNIÃO': '22' } }, // Omar Aziz (PSD, com o PT) × Maria do Carmo (PL)
  df: { base: '1', partidos: { PL: '11', PT: '13' } }, // Celina Leão (PP, com o PL) × Leandro Grass (PT)
  es: { base: '3', partidos: { PL: '10', PSB: '15' } }, // Pazolini (Republicanos, com o PL) × Ferraço (MDB, com o PSB)
  rj: { base: '1', partidos: { PL: '22', PT: '55' } }, // Douglas Ruas (PL) × Eduardo Paes (PSD, com o PT)
  rn: { base: '1', partidos: { PL: '44', PT: '13' } }, // Allyson (União) × Cadu de Lula (PT)
  to: { base: '1', partidos: { PL: '44', PT: '45' } }, // Dorinha (União, com o PL) × Vicentinho Júnior (PSDB)
};

const pad = (s, n) => String(s).padStart(n, '0');
const ler = async (u) => JSON.parse(zlib.gunzipSync(await fs.readFile(u)));

// ---------- base: 2º turno de 2022 por zona ----------

async function csv2022(conjunto) {
  const nome = `${conjunto}_2022_BRASIL.csv`;
  const destino = path.join(CACHE, nome);
  try {
    await fs.access(destino);
  } catch {
    await fs.mkdir(CACHE, { recursive: true });
    const zip = path.join(CACHE, `${conjunto}_2022.zip`);
    console.log(`Baixando ${conjunto}_2022.zip…`);
    const res = await fetch(`${CDN}/${conjunto}/${conjunto}_2022.zip`);
    if (!res.ok) throw new Error(`${conjunto}: HTTP ${res.status}`);
    await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()));
    execFileSync('unzip', ['-oq', zip, nome, '-d', CACHE]);
  }
  return destino;
}

/** Linhas do CSV do TSE (latin1, ";", aspas opcionais) do 2º turno, como objetos. */
async function* linhas2turno(arquivo) {
  const rl = readline.createInterface({ input: createReadStream(arquivo, { encoding: 'latin1' }), crlfDelay: Infinity });
  let cab = null;
  for await (const l of rl) {
    const campos = l.split(';').map((c) => c.replace(/^"|"$/g, ''));
    if (!cab) { cab = campos; continue; }
    if (campos[5] !== '2') continue; // NR_TURNO
    yield Object.fromEntries(cab.map((k, i) => [k, campos[i]]));
  }
}

/** base[cargo][`uf mun zona`] = { aptos, comp, brancos, nulos, partidos: { sigla: votos } } */
async function lerBase() {
  const base = { 1: new Map(), 3: new Map() };
  const de = (r) => {
    const m = base[r.CD_CARGO];
    if (!m) return null;
    const k = `${r.SG_UF.toLowerCase()} ${pad(r.CD_MUNICIPIO, 5)} ${pad(r.NR_ZONA, 4)}`;
    if (!m.has(k)) m.set(k, { aptos: 0, comp: 0, brancos: 0, nulos: 0, partidos: {} });
    return m.get(k);
  };
  for await (const r of linhas2turno(await csv2022('detalhe_votacao_munzona'))) {
    const z = de(r);
    if (!z) continue;
    z.aptos += Number(r.QT_APTOS);
    z.comp += Number(r.QT_COMPARECIMENTO);
    z.brancos += Number(r.QT_VOTOS_BRANCOS);
    z.nulos += Number(r.QT_TOTAL_VOTOS_NULOS);
  }
  for await (const r of linhas2turno(await csv2022('votacao_partido_munzona'))) {
    const z = de(r);
    if (z) z.partidos[r.SG_PARTIDO] = (z.partidos[r.SG_PARTIDO] ?? 0) + Number(r.QT_VOTOS_NOMINAIS_VALIDOS);
  }
  return base;
}

/** Soma as zonas de 2022 cujo prefixo (`uf` ou `uf mun`) bate: taxa de reserva para zonas novas. */
function agregar(mapa, prefixo) {
  const t = { aptos: 0, comp: 0, brancos: 0, nulos: 0, partidos: {} };
  for (const [k, z] of mapa) {
    if (!k.startsWith(prefixo)) continue;
    t.aptos += z.aptos; t.comp += z.comp; t.brancos += z.brancos; t.nulos += z.nulos;
    for (const [p, v] of Object.entries(z.partidos)) t.partidos[p] = (t.partidos[p] ?? 0) + v;
  }
  return t.aptos ? t : null;
}

// ---------- montagem dos JSONs no formato do TSE ----------

const fmtPct = (n, d) => (d ? ((100 * n) / d).toFixed(2) : '0.00').replace('.', ',');
/** % do candidato como o TSE (e como `pvapCalculado` do arquivo): quem tem voto nunca fica com 0,00. */
const pctCand = (n, d) => {
  if (!d || !n) return '0,00';
  const p = ((n * 100) / d).toFixed(2);
  return (p === '0.00' ? '0.01' : p).replace('.', ',');
};

/** Números de uma região: te/ts do 1º turno de 2026, taxas de 2022. */
function numerosZona(te, ts, b, partidos) {
  const taxa = (n, d) => (d ? n / d : 0); // há zonas no exterior sem nenhum comparecimento em 2022
  const comp = Math.round(te * taxa(b.comp, b.aptos));
  const brancos = Math.round(comp * taxa(b.brancos, b.comp));
  const nulos = Math.round(comp * taxa(b.nulos, b.comp));
  const vv = comp - brancos - nulos;
  const [pa, pb] = Object.keys(partidos);
  const va = b.partidos[pa] ?? 0;
  const vb = b.partidos[pb] ?? 0;
  const a = va + vb ? Math.round((vv * va) / (va + vb)) : Math.round(vv / 2);
  return { te, ts, comp, brancos, nulos, vv, votos: { [partidos[pa]]: a, [partidos[pb]]: vv - a } };
}

function somar(lista) {
  const t = { te: 0, ts: 0, comp: 0, brancos: 0, nulos: 0, vv: 0, votos: {} };
  for (const n of lista) {
    for (const k of ['te', 'ts', 'comp', 'brancos', 'nulos', 'vv']) t[k] += n[k];
    for (const [c, v] of Object.entries(n.votos)) t.votos[c] = (t.votos[c] ?? 0) + v;
  }
  return t;
}

/**
 * JSON do 2º turno de uma região a partir do JSON do 1º turno (mesmos campos de topo, mesmas
 * agremiações/partidos/candidatos, só os dois finalistas) e dos números simulados.
 */
function montar(raw1, eleicao, n, vencedor) {
  const s = String;
  const { carg: [c1], s: _s, e: _e, v: _v, ...topo } = raw1;
  const agr = [];
  for (const a of c1.agr) {
    const par = [];
    for (const p of a.par) {
      const cand = p.cand.filter((c) => c.n in n.votos).map((c) => {
        const { pvapn: _x, ...resto } = c;
        const vap = n.votos[c.n];
        return { ...resto, e: c.n === vencedor ? 's' : 'n', st: c.n === vencedor ? 'Eleito' : 'Não eleito', vap: s(vap), pvap: pctCand(vap, n.vv) };
      });
      if (!cand.length) continue;
      const tv = cand.reduce((t, c) => t + Number(c.vap), 0);
      par.push({ ...p, tvtn: s(tv), tvan: s(tv), cand });
    }
    if (!par.length) continue;
    const tv = par.reduce((t, p) => t + Number(p.tvtn), 0);
    agr.push({ ...a, tvtn: s(tv), tvan: s(tv), par });
  }
  const a = n.te - n.comp;
  return {
    ...topo,
    ele: eleicao, t: '2', dg: DATA, hg: HORA, dt: DATA, ht: HORA, tf: 's',
    carg: [{ ...c1, agr }],
    s: { ts: s(n.ts), st: s(n.ts), pst: '100,00', snt: '0', psnt: '0,00' },
    e: {
      te: s(n.te), est: s(n.te), pest: '100,00', esnt: '0', pesnt: '0,00',
      c: s(n.comp), pc: fmtPct(n.comp, n.te), a: s(a), pa: fmtPct(a, n.te),
    },
    v: {
      tv: s(n.comp), vvc: s(n.vv), pvvc: fmtPct(n.vv, n.comp), vv: s(n.vv), pvv: '100,00', vnom: s(n.vv), pvnom: '100,00',
      van: '0', pvan: '0,00', vansj: '0', pvansj: '0,00',
      vb: s(n.brancos), pvb: fmtPct(n.brancos, n.comp), tvn: s(n.nulos), ptvn: fmtPct(n.nulos, n.comp),
      vn: s(n.nulos), pvn: '100,00', vnt: '0', pvnt: '0,00',
    },
  };
}

// ---------- principal ----------

async function gravar(nome, dado, { gz = true } = {}) {
  const destino = new URL(nome, PASTA);
  await fs.mkdir(new URL('.', destino), { recursive: true });
  const texto = JSON.stringify(dado);
  const buf = gz ? zlib.gzipSync(texto, { level: 9 }) : Buffer.from(`${JSON.stringify(dado, null, 1)}\n`);
  await fs.writeFile(destino, buf);
  return buf.length;
}

/** Finalistas (número → partido) de uma UF, pelo `st` do 1º turno. */
function finalistas(modelo) {
  const out = [];
  for (const a of modelo.carg[0].agr) for (const p of a.par) for (const c of p.cand) if (/2.?\s*turno/i.test(c.st || '')) out.push(c.n);
  return out;
}

const base = await lerBase();
console.log(`Base 2022: ${base[1].size} zonas (Presidente), ${base[3].size} zonas (Governador)`);
await fs.rm(PASTA, { recursive: true, force: true });

const manifesto = { ciclo: 'ele2026', turno: 2, simulacao: true, fonte: 'Dados Abertos do TSE, 2º turno de 2022', unidades: {} };
const brPresidente = []; // unidades do Presidente, gravadas depois de somar o Brasil
const ufsGovernador = [];
const lider = (n) => Object.entries(n.votos).sort((a, b) => b[1] - a[1])[0][0];

for (const [eleicao, def] of Object.entries(ELEICOES)) {
  const pasta1 = new URL(`${def.primeiro}/`, PRIMEIRO);
  const cm = await ler(new URL('mun-cm.json.gz', pasta1));
  const c4 = pad(def.cargo, 4);
  const ufs = def.cargo === '1' ? cm.abr.map((a) => a.cd.toLowerCase()).concat('zz') : Object.keys(GOVERNADOR);
  const finalBr = def.cargo === '1' ? finalistas((await ler(new URL(`br-c${c4}-uf.json.gz`, pasta1)))) : null;
  if (finalBr && finalBr.sort().join() !== Object.values(PRESIDENTE).sort().join()) {
    throw new Error(`Finalistas do Presidente mudaram (${finalBr}): atualize PRESIDENTE`);
  }

  for (const uf of [...new Set(ufs)]) {
    const u1 = await ler(new URL(`${uf}-c${c4}.json.gz`, pasta1));
    if (!u1) throw new Error(`sem a unidade ${uf}-c${c4} do 1º turno`);
    const gov = GOVERNADOR[uf];
    const partidos = def.cargo === '1' ? PRESIDENTE : gov.partidos;
    if (def.cargo === '3' && finalistas(u1.modelo).sort().join() !== Object.values(partidos).sort().join()) {
      throw new Error(`Finalistas de ${uf} mudaram (${finalistas(u1.modelo)}): atualize GOVERNADOR`);
    }
    const mapa = base[def.cargo === '1' ? 1 : gov.base];
    const reservaUf = agregar(mapa, `${uf} `);
    if (!reservaUf) throw new Error(`sem base de 2022 para ${uf}`);

    // Zonas: números simulados; municípios: soma das zonas.
    const zonas = new Map(); // `uf mun` → [números]
    let semZona = 0;
    for (const abr of Object.keys(u1.regioes)) {
      const m = /^[a-z]{2}(\d{5})-z(\d{4})$/.exec(abr);
      if (!m) continue;
      const r1 = expandir(u1, abr);
      let b = mapa.get(`${uf} ${m[1]} ${m[2]}`);
      if (!b) { semZona++; b = agregar(mapa, `${uf} ${m[1]} `) ?? reservaUf; }
      const n = numerosZona(Number(r1.e.te), Number(r1.s.ts), b, partidos);
      if (!zonas.has(m[1])) zonas.set(m[1], []);
      zonas.get(m[1]).push([abr, n]);
    }
    const numeros = new Map();
    for (const [mun, lista] of zonas) {
      for (const [abr, n] of lista) numeros.set(abr, n);
      numeros.set(`${uf}${mun}`, somar(lista.map(([, n]) => n)));
    }
    const nUf = somar([...zonas.keys()].map((mun) => numeros.get(`${uf}${mun}`)));
    const unidade = { uf, u1, numeros, nUf };
    // Presidente: o vencedor é o do Brasil, gravado depois de somar todas as UFs.
    if (def.cargo === '1') brPresidente.push(unidade);
    else {
      ufsGovernador.push(uf);
      await gravarUnidade(eleicao, c4, { ...unidade, venc: lider(nUf) });
    }
    if (semZona) console.log(`  ${uf}: ${semZona} zonas sem par em 2022 (taxas do município)`);
  }

  if (def.cargo === '1') {
    const nBr = somar(brPresidente.map((x) => x.nUf));
    const venc = lider(nBr);
    const modeloBr = await ler(new URL(`br-c${c4}-uf.json.gz`, pasta1));
    const rawBr = montar(modeloBr, eleicao, nBr, venc);
    const chave = `${eleicao}/br-c${c4}`;
    const bytes = await gravar(`${chave}.json.gz`, novaUnidade('br', rawBr));
    await gravar(`${chave}-uf.json.gz`, rawBr);
    manifesto.unidades[chave] = { cargo: def.ds, final: true, regioes: 0, faltando: 0, bytes };
    console.log(`${chave}: ${fmtPct(nBr.votos['13'], nBr.vv)}% Lula × ${fmtPct(nBr.votos['22'], nBr.vv)}% Flávio`);
    for (const x of brPresidente) await gravarUnidade(eleicao, c4, { ...x, venc });
  }

  // Municípios/zonas e abrangência: as do 1º turno (mesmo eleitorado e seções), só com as UFs da eleição.
  const doTurno = (uf) => ufs.includes(uf);
  await gravar(`${eleicao}/mun-cm.json.gz`, { ...cm, abr: cm.abr.filter((a) => doTurno(a.cd.toLowerCase())) });
  for (const uf of ['br', ...new Set(ufs)]) {
    const ab = await ler(new URL(`${uf}-ab.json.gz`, pasta1)).catch(() => null);
    if (!ab) continue;
    const abr = uf === 'br' ? ab.abr.filter((a) => a.tpabr !== 'uf' || doTurno(a.cdabr)) : ab.abr;
    await gravar(`${eleicao}/${uf}-ab.json.gz`, { ...ab, ele: eleicao, t: '2', dg: DATA, hg: HORA, abr });
  }
}

async function gravarUnidade(eleicao, c4, { uf, u1, numeros, nUf, venc }) {
  const rawUf = montar(u1.modelo, eleicao, nUf, venc);
  const u = novaUnidade(uf, rawUf);
  for (const [abr, n] of numeros) adicionarRegiao(u, abr, montar(expandir(u1, abr), eleicao, n, venc));
  const chave = `${eleicao}/${uf}-c${c4}`;
  const bytes = await gravar(`${chave}.json.gz`, u);
  await gravar(`${chave}-uf.json.gz`, rawUf);
  manifesto.unidades[chave] = { cargo: ELEICOES[eleicao].ds, final: true, regioes: numeros.size, faltando: 0, bytes };
}

await gravar('manifesto.json', manifesto, { gz: false });

// Pleito que o servidor acrescenta ao ele-c.json do TSE (como o TSE publicará o 2º turno).
await gravar('simulacao.json', {
  gerado: new Date().toISOString(),
  base: '2º turno de 2022 (Dados Abertos do TSE), aplicado ao eleitorado do 1º turno de 2026',
  fotos: Object.fromEntries(Object.entries(ELEICOES).map(([e, d]) => [e, d.primeiro])),
  pleito: {
    cd: 'simulacao', c: 'ele2026', dt: DATA, dtlim: '25/10/2034',
    e: Object.entries(ELEICOES).map(([cd, d]) => ({
      cd, cdt2: '', nm: d.nm, t: '2', tp: d.tp,
      abr: (d.cargo === '1' ? ['br'] : ufsGovernador).map((uf) => ({ cd: uf, cp: [{ cd: d.cargo, ds: d.ds, tp: '1' }] })),
    })),
  },
}, { gz: false });

const total = Object.values(manifesto.unidades).reduce((t, u) => t + u.bytes, 0);
console.log(`Simulação gravada em ${PASTA.pathname} (${(total / 2 ** 20).toFixed(1)} MB)`);
