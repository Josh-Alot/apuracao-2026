// Servidor HTTP sem dependências: API (/api/*) que agrega o TSE e o IBGE + arquivos estáticos do build.

import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getConfig, getMunicipios, getResultado, getResultadosRapidos, getAbrangencia, resumo, fetchJson, UFS,
  PRIORIDADE, estadoFila, apuracaoEncerrada,
} from './tse.mjs';
import { assinar } from './aovivo.mjs';
import { getCandidato } from './candidatos.mjs';
import { estadoArquivo } from './arquivo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const GEO_CACHE = path.join(ROOT, '.cache', 'geo');
const PORT = Number(process.env.PORT || 3001);

const IBGE_UF = {
  11: 'ro', 12: 'ac', 13: 'am', 14: 'rr', 15: 'pa', 16: 'ap', 17: 'to', 21: 'ma', 22: 'pi',
  23: 'ce', 24: 'rn', 25: 'pb', 26: 'pe', 27: 'al', 28: 'se', 29: 'ba', 31: 'mg', 32: 'es',
  33: 'rj', 35: 'sp', 41: 'pr', 42: 'sc', 43: 'rs', 50: 'ms', 51: 'mt', 52: 'go', 53: 'df',
};

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function cargoDe(id) {
  const cfg = await getConfig();
  const c = cfg.cargos.find((x) => x.id === id);
  if (!c) throw new HttpError(400, `cargo desconhecido: ${id}`);
  return c;
}

const uf = (s) => {
  const v = String(s || '').toLowerCase();
  if (v !== 'br' && v !== 'zz' && !UFS.includes(v)) throw new HttpError(400, `UF inválida: ${s}`);
  return v;
};

// ---------- handlers ----------

async function paramsResultado(q) {
  const c = await cargoDe(q.get('cargo'));
  const mun = q.get('mun') || undefined;
  const zona = q.get('zona') || undefined;
  if ((mun && !/^\d{5}$/.test(mun)) || (zona && !/^\d{1,4}$/.test(zona))) throw new HttpError(400, 'município/zona inválidos');
  return { eleicao: c.eleicao, cargo: c.cargo, uf: uf(q.get('uf') || 'br'), mun, zona };
}

async function resultado(q) {
  const params = await paramsResultado(q);
  const r = await getResultado(params);
  if (!r) throw new HttpError(404, 'Sem dados para esta abrangência/cargo.');
  return r;
}

async function mapa(q) {
  const c = await cargoDe(q.get('cargo'));
  const u = uf(q.get('uf') || 'br');
  const mun = q.get('mun');
  const base = { eleicao: c.eleicao, cargo: c.cargo };

  // Para colorir o mapa basta o líder: com todas as seções totalizadas ele não muda mais.
  const opcoes = { ttlCompletoMs: 30 * 60_000 };

  if (u === 'br') {
    const ufs = c.ufs;
    const rs = await getResultadosRapidos(ufs.map((x) => ({ ...base, uf: x })), 30_000, PRIORIDADE.media, opcoes);
    return Object.fromEntries(ufs.map((x, i) => [x, resumo(rs[i])]));
  }

  const municipios = (await getMunicipios(c.eleicao))?.[u]?.municipios ?? [];
  if (mun) {
    const zonas = municipios.find((m) => m.cd === mun)?.zonas ?? [];
    const rs = await getResultadosRapidos(zonas.map((z) => ({ ...base, uf: u, mun, zona: z })), 60_000, PRIORIDADE.baixa, opcoes);
    return Object.fromEntries(zonas.map((z, i) => [z, resumo(rs[i])]));
  }

  // Cargos proporcionais têm arquivos grandes (milhares de candidatos) — para o mapa
  // estadual usamos só o % apurado, que vem de um único arquivo de abrangência.
  if (c.tipo === 'proporcional') return getAbrangencia(c.eleicao, u);

  // Um arquivo por município (853 em MG): entram na fila com prioridade baixa e o mapa vai se
  // completando a cada atualização, em vez de disparar centenas de consultas de uma vez.
  const rs = await getResultadosRapidos(municipios.map((m) => ({ ...base, uf: u, mun: m.cd })), 3 * 60_000, PRIORIDADE.baixa, opcoes);
  return Object.fromEntries(municipios.map((m, i) => [m.cd, resumo(rs[i])]));
}

// ---------- busca de candidatos ----------

const indices = new Map(); // chave -> { ts, ttl, promise }
const INDICE_TTL = 30_000;
// Índice montado antes de todas as listas chegarem do TSE (estão na fila): vale pouco, para a
// próxima busca já incluir o que chegou.
const INDICE_PARCIAL_TTL = 4_000;

async function indiceBusca(cargoId, ufFiltro) {
  const chave = `${cargoId || '*'}|${ufFiltro || '*'}`;
  const hit = indices.get(chave);
  if (hit && Date.now() - hit.ts < hit.ttl) return hit.promise;

  const promise = (async () => {
    const cfg = await getConfig();
    const cargos = cfg.cargos.filter((c) => !cargoId || c.id === cargoId);
    const alvos = [];
    for (const c of cargos) {
      if (c.escopo === 'br') alvos.push({ c, uf: ufFiltro || 'br' });
      else for (const u of c.ufs) if (!ufFiltro || u === ufFiltro) alvos.push({ c, uf: u });
    }
    // A busca não precisa de votos ao segundo: usa o que estiver em cache e renova devagar.
    const rs = await getResultadosRapidos(
      alvos.map(({ c, uf: u }) => ({ eleicao: c.eleicao, cargo: c.cargo, uf: u })), 2 * 60_000, PRIORIDADE.baixa,
    );
    const out = [];
    const faltando = rs.filter((r) => r === undefined).length;
    alvos.forEach(({ c, uf: u }, i) => {
      const r = rs[i];
      if (!r) return;
      for (const cand of r.candidatos) {
        out.push({
          ...cand,
          vices: undefined,
          cargoId: c.id,
          cargoNome: c.nome,
          uf: u,
          pctApurado: r.secoes.pct,
          chave: normalizarTexto(`${cand.nomeUrna} ${cand.nome} ${cand.partido}`),
        });
      }
    });
    const indice = { itens: out, listas: alvos.length, faltando };
    if (faltando) {
      const e = indices.get(chave);
      if (e?.promise === promise) e.ttl = INDICE_PARCIAL_TTL;
    }
    return indice;
  })();
  promise.catch(() => indices.delete(chave));
  indices.set(chave, { ts: Date.now(), ttl: INDICE_TTL, promise });
  return promise;
}

const normalizarTexto = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function busca(q) {
  const termo = (q.get('q') || '').trim();
  const partido = (q.get('partido') || '').trim().toUpperCase();
  // Com partido escolhido o termo é opcional: a busca lista todos os candidatos do partido.
  if (!partido && termo.length < 2 && !/^\d+$/.test(termo)) return { total: 0, itens: [], parcial: null, partidos: [] };
  const cargoId = q.get('cargo') || '';
  const ufFiltro = q.get('uf') ? uf(q.get('uf')) : '';
  const { itens: indice, listas, faltando } = await indiceBusca(cargoId, ufFiltro === 'br' ? '' : ufFiltro);
  const partidos = [...new Set(indice.map((c) => c.partido))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  let hits = partido ? indice.filter((c) => c.partido.toUpperCase() === partido) : indice;
  if (/^\d+$/.test(termo)) {
    hits = hits.filter((c) => c.numero.startsWith(termo));
    hits.sort((a, b) => (b.numero === termo) - (a.numero === termo) || b.votos - a.votos);
  } else if (termo) {
    const tokens = normalizarTexto(termo).split(/\s+/).filter(Boolean);
    hits = hits.filter((c) => tokens.every((t) => c.chave.includes(t)));
    hits.sort((a, b) => b.votos - a.votos);
  } else {
    // Só o partido: agrupa por cargo (na ordem da config) e, dentro do cargo, por votos.
    const ordem = new Map((await getConfig()).cargos.map((c, i) => [c.id, i]));
    hits = [...hits].sort((a, b) => ordem.get(a.cargoId) - ordem.get(b.cargoId) || b.votos - a.votos);
  }
  // Por partido a lista pode passar de mil candidatos: o front pede em páginas ("Mostrar mais").
  const limite = Math.min(Number(q.get('limite') || 50), partido ? 5000 : 200);
  return {
    total: hits.length,
    itens: hits.slice(0, limite).map(({ chave, ...resto }) => resto),
    // Listas de candidatos (cargo × UF) que ainda não chegaram do TSE: a busca está incompleta.
    parcial: faltando ? { listas, faltando } : null,
    partidos,
  };
}

// ---------- malhas do IBGE (cache em disco: mudam raramente) ----------

async function geo(alvo) {
  const arquivo = path.join(GEO_CACHE, `${alvo}.json`);
  try {
    return JSON.parse(await fs.readFile(arquivo, 'utf8'));
  } catch { /* não está em cache */ }

  const url = alvo === 'br'
    ? 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF'
    : `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${alvo.toUpperCase()}?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio`;
  const data = await fetchJson(url, Infinity);
  if (!data) throw new HttpError(404, 'malha não encontrada');
  for (const f of data.features) {
    const cod = f.properties.codarea;
    f.properties = alvo === 'br' ? { uf: IBGE_UF[cod] } : { ibge: cod };
  }
  await fs.mkdir(GEO_CACHE, { recursive: true });
  await fs.writeFile(arquivo, JSON.stringify(data));
  return data;
}

/** Configuração + `encerrada` por cargo: com a apuração encerrada o front não fica consultando o TSE. */
async function configComSituacao() {
  const cfg = await getConfig();
  const eleicoes = [...new Set(cfg.cargos.map((c) => c.eleicao))];
  const encerradas = new Map(await Promise.all(eleicoes.map(async (e) => [e, await apuracaoEncerrada(e)])));
  return { ...cfg, cargos: cfg.cargos.map((c) => ({ ...c, encerrada: encerradas.get(c.eleicao) })) };
}

// ---------- roteamento ----------

const rotas = {
  '/api/config': configComSituacao,
  '/api/municipios': async (q) => {
    const c = await cargoDe(q.get('cargo'));
    return getMunicipios(c.eleicao);
  },
  '/api/resultado': resultado,
  '/api/mapa': mapa,
  '/api/busca': busca,
  // Diagnóstico: fila de consultas ao TSE, cache e memória.
  '/api/saude': () => ({ fila: estadoFila(), arquivo: estadoArquivo(), memoriaMB: Math.round(process.memoryUsage().rss / 2 ** 20) }),
};

// No log do Render: estado da fila a cada minuto, quando há algo esperando.
setInterval(() => {
  const f = estadoFila();
  if (f.alta + f.media + f.baixa) console.log('fila TSE', JSON.stringify(f));
}, 60_000).unref();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
};

async function estatico(res, pathname) {
  let file = path.join(DIST, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST)) file = path.join(DIST, 'index.html');
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Build não encontrado. Rode `npm run build` ou use `npm run dev`.');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status, body) => {
    const texto = JSON.stringify(body);
    // Respostas de sucesso levam ETag e "no-cache": o navegador guarda, mas sempre revalida — e se
    // nada mudou recebe 304 sem corpo (o polling de 30 s deixa de baixar o JSON inteiro de novo).
    if (status === 200 && url.pathname !== '/api/saude') {
      const etag = `"${createHash('sha1').update(texto).digest('base64url').slice(0, 22)}"`;
      const cabecalhos = { etag, 'cache-control': 'no-cache' };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, cabecalhos);
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...cabecalhos });
      return res.end(texto);
    }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(texto);
  };
  try {
    const geoMatch = url.pathname.match(/^\/api\/geo\/([a-z]{2})$/);
    if (geoMatch) {
      const alvo = geoMatch[1] === 'br' ? 'br' : uf(geoMatch[1]);
      const data = await geo(alvo);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' });
      return res.end(JSON.stringify(data));
    }
    const candMatch = url.pathname.match(/^\/api\/candidato\/(\d{1,15})$/);
    if (candMatch) {
      const data = await getCandidato(candMatch[1]);
      if (!data) return json(404, { erro: 'candidato não encontrado' });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' });
      return res.end(JSON.stringify(data));
    }
    if (url.pathname === '/api/ao-vivo') return assinar(req, res, await paramsResultado(url.searchParams));
    const rota = rotas[url.pathname];
    if (rota) return json(200, await rota(url.searchParams));
    if (url.pathname.startsWith('/api/')) return json(404, { erro: 'rota inexistente' });
    return estatico(res, url.pathname);
  } catch (err) {
    const status = err.status || 502;
    if (status >= 500 && !err.silencioso) console.error(err); // falhas do TSE já saem resumidas no log
    return json(status, { erro: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`API em http://localhost:${PORT}${process.env.DEMO === '1' ? '  [MODO DEMO]' : ''}`);
});
