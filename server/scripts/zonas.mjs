// Gera dados/zonas-2026.json.gz: contorno ESTIMADO de cada zona eleitoral nos municípios com mais de uma zona.
// Rodar com `npm run zonas` (opção `--uf sp,rj`). O TSE não publica a malha das zonas; aqui cada ponto do
// município fica com a zona do local de votação mais próximo (diagrama de Voronoi dos locais, Dados Abertos
// `eleitorado_local_votacao`), as células da mesma zona são juntadas e recortadas pelo contorno do município
// (a mesma malha do IBGE que o mapa usa, em dados/malhas). Usa o `unzip` do sistema e as dependências de
// desenvolvimento d3-delaunay e polygon-clipping: só roda na máquina de quem publica; o servidor só lê o resultado.

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';
import { lerMalha } from '../malhas.mjs';
import { ROOT, baixarDadosAbertos, extrairCsv, lerCsv, opcao } from './comum.mjs';

const ANO = 2026;
const SAIDA = path.join(ROOT, 'dados', `zonas-${ANO}.json.gz`);
const MUN_CM = path.join(ROOT, 'arquivo', `ele${ANO}-1turno`, '6259', 'mun-cm.json.gz');
const CONJUNTO = 'eleitorado_local_votacao';
/** Local de votação fora do contorno do município: até esta distância (km) é tolerado (malha simplificada). */
const TOLERANCIA_KM = 1;
/** Casas decimais das coordenadas gravadas (5 ≈ 1 m). */
const CASAS = 5;

const soUfs = opcao('uf')?.toLowerCase().split(',');

/** Malha dos municípios da UF, a mesma do mapa (dados/malhas, senão .cache/geo, senão o IBGE; ver malhas.mjs). */
async function malhaUf(uf) {
  const texto = await lerMalha(uf);
  if (!texto) throw new Error(`malha ${uf}: o IBGE não tem esta malha`);
  return JSON.parse(texto);
}

const poligonos = (g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]);

/** Ponto dentro do multipolígono (par/ímpar, considera buracos). */
function dentro(polis, x, y) {
  let d = false;
  for (const p of polis) {
    for (const anel of p) {
      for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        const [xi, yi] = anel[i], [xj, yj] = anel[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
      }
    }
  }
  return d;
}

/** Distância (km) do ponto à borda do multipolígono, em coordenadas planas (lon·cos(lat), lat). */
function distanciaBordaKm(polis, x, y, k) {
  let min = Infinity;
  for (const p of polis) {
    for (const anel of p) {
      for (let i = 1; i < anel.length; i++) {
        const ax = anel[i - 1][0] * k, ay = anel[i - 1][1], bx = anel[i][0] * k, by = anel[i][1];
        const dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x * k - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        min = Math.min(min, Math.hypot(x * k - ax - t * dx, y - ay - t * dy));
      }
    }
  }
  return min * 111.32;
}

const arred = (v) => Math.round(v * 10 ** CASAS) / 10 ** CASAS;

/** Arredonda e tira vértices repetidos; descarta anéis que ficam degenerados. */
function limpar(multi) {
  const out = [];
  for (const p of multi) {
    const aneis = [];
    for (const anel of p) {
      const a = [];
      for (const [x, y] of anel) {
        const q = [arred(x), arred(y)];
        const u = a[a.length - 1];
        if (!u || u[0] !== q[0] || u[1] !== q[1]) a.push(q);
      }
      if (a.length >= 4) aneis.push(a);
    }
    if (aneis.length) out.push(aneis);
  }
  return out;
}

/**
 * Zonas de um município: Voronoi dos locais (em coordenadas planas, para a distância ser a de verdade),
 * células juntadas por zona e recortadas pelo contorno. Locais no mesmo ponto ficam com a zona de mais eleitores.
 */
function zonasDoMunicipio(geometria, locais) {
  const polis = poligonos(geometria);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polis) for (const [x, y] of p[0]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);

  // Um ponto por coordenada; a zona é a de mais eleitores naquele ponto.
  const porPonto = new Map();
  let fora = 0;
  for (const l of locais) {
    if (!dentro(polis, l.x, l.y) && distanciaBordaKm(polis, l.x, l.y, k) > TOLERANCIA_KM) {
      fora++;
      continue;
    }
    const chave = `${arred(l.x)},${arred(l.y)}`;
    const p = porPonto.get(chave) ?? { x: l.x, y: l.y, zonas: new Map() };
    p.zonas.set(l.zona, (p.zonas.get(l.zona) ?? 0) + l.eleitores);
    porPonto.set(chave, p);
  }
  const pontos = [...porPonto.values()].map((p) => ({
    x: p.x, y: p.y, zona: [...p.zonas].sort((a, b) => b[1] - a[1])[0][0],
  }));
  if (new Set(pontos.map((p) => p.zona)).size < 2) return { zonas: {}, fora };

  const folga = Math.max(x1 - x0, y1 - y0);
  const voronoi = Delaunay.from(pontos, (p) => p.x * k, (p) => p.y).voronoi([
    (x0 - folga) * k, y0 - folga, (x1 + folga) * k, y1 + folga,
  ]);
  const celulas = new Map();
  pontos.forEach((p, i) => {
    const c = voronoi.cellPolygon(i);
    if (!c) return;
    const lista = celulas.get(p.zona) ?? [];
    lista.push([c.map(([x, y]) => [x / k, y])]);
    celulas.set(p.zona, lista);
  });

  const zonas = {};
  for (const [zona, lista] of celulas) {
    const unida = polygonClipping.union(lista[0], ...lista.slice(1));
    const recortada = limpar(polygonClipping.intersection(unida, polis));
    if (recortada.length) zonas[zona] = recortada;
  }
  return { zonas, fora };
}

// ---------- principal ----------

const munCm = JSON.parse(zlib.gunzipSync(await fs.readFile(MUN_CM)).toString());
const ZIP = await baixarDadosAbertos(CONJUNTO, ANO);

const saida = { gerado: null, fonte: `${CONJUNTO}_${ANO}`, municipios: {} };
let totalZonas = 0, semContorno = 0;
for (const abr of munCm.abr) {
  const uf = abr.cd;
  if (uf === 'zz' || (soUfs && !soUfs.includes(uf))) continue;
  const alvos = abr.mu.filter((m) => m.z.length > 1 && m.cdi);
  if (!alvos.length) continue;

  const csv = `${CONJUNTO}_${ANO}_${uf.toUpperCase()}.csv`;
  const arquivoCsv = extrairCsv(ZIP, csv);
  const { col, linhas } = lerCsv(await fs.readFile(arquivoCsv));
  await fs.rm(arquivoCsv);
  saida.gerado ??= `${linhas[0][col.DT_GERACAO]} ${linhas[0][col.HH_GERACAO]}`;

  // Locais por município (uma linha por seção: soma os eleitores de cada local).
  const cds = new Set(alvos.map((m) => m.cd));
  const locais = new Map();
  for (const l of linhas) {
    const cd = l[col.CD_MUNICIPIO];
    if (!cds.has(cd)) continue;
    const y = Number(l[col.NR_LATITUDE]?.replace(',', '.'));
    const x = Number(l[col.NR_LONGITUDE]?.replace(',', '.'));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x === -1 || y === -1 || (x === 0 && y === 0)) continue;
    const zona = l[col.NR_ZONA].padStart(4, '0');
    const chave = `${cd}|${zona}|${l[col.NR_LOCAL_VOTACAO]}`;
    const loc = locais.get(chave) ?? { cd, zona, x, y, eleitores: 0 };
    loc.eleitores += Number(l[col.QT_ELEITOR_SECAO]) || 0;
    locais.set(chave, loc);
  }

  const malha = await malhaUf(uf);
  const porIbge = new Map(malha.features.map((f) => [f.properties.ibge, f.geometry]));
  for (const m of alvos) {
    const geometria = porIbge.get(m.cdi);
    if (!geometria) {
      console.warn(`${uf} ${m.nm}: sem malha do IBGE (${m.cdi})`);
      continue;
    }
    const { zonas, fora } = zonasDoMunicipio(geometria, [...locais.values()].filter((l) => l.cd === m.cd));
    const faltam = m.z.filter((z) => !zonas[z]);
    if (Object.keys(zonas).length) saida.municipios[m.cd] = zonas;
    totalZonas += Object.keys(zonas).length;
    semContorno += faltam.length;
    const avisos = [fora && `${fora} locais fora do município`, faltam.length && `sem contorno: ${faltam.join(', ')}`]
      .filter(Boolean).join('; ');
    if (avisos) console.warn(`${uf} ${m.nm}: ${avisos}`);
  }
  console.log(`${uf}: ${alvos.length} municípios com mais de uma zona`);
}

const gz = zlib.gzipSync(JSON.stringify(saida), { level: 9 });
await fs.mkdir(path.dirname(SAIDA), { recursive: true });
await fs.writeFile(SAIDA, gz);
console.log(`${Object.keys(saida.municipios).length} municípios, ${totalZonas} zonas (${semContorno} sem contorno; TSE: ${saida.gerado})`);
console.log(`${path.relative(ROOT, SAIDA)}: ${(gz.length / 1e6).toFixed(2)} MB`);
