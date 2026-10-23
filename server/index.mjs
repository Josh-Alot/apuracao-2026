// Servidor HTTP sem dependências: API (/api/*) que agrega o TSE e o IBGE + arquivos estáticos do build.
// Aqui só o despacho; as rotas JSON ficam em server/rotas/ (tabela em rotas/index.mjs).

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assinar } from './aovivo.mjs';
import { getCandidato } from './candidatos.mjs';
import { flagsDe, rotaPreview, rotaFlags } from './flags.mjs';
import { etagDe, validarUf } from './http.mjs';
import { redirecionarHost, responderPagina, responderRobots, responderSitemap, candidaturaDe } from './seo.mjs';
import { ROTAS_JSON } from './rotas/index.mjs';
import { paramsResultado } from './rotas/resultado.mjs';
import { geo } from './rotas/geo.mjs';
import { vigiarMemoria } from './rotas/saude.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 3001);

vigiarMemoria();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

/**
 * Arquivo do build, se existir; senão robots.txt, sitemaps ou uma página do app (HTML por rota, com 404 de
 * verdade para rota inexistente — ver seo.mjs). Os /assets/* têm hash no nome: cache de 1 ano.
 */
async function estatico(req, res, pathname) {
  const file = path.join(DIST, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (file.startsWith(DIST) && pathname !== '/' && pathname !== '/index.html') {
    try {
      if ((await fs.stat(file)).isFile()) {
        const body = await fs.readFile(file);
        res.writeHead(200, {
          'content-type': MIME[path.extname(file)] || 'application/octet-stream',
          'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
            : path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
        });
        return res.end(body);
      }
    } catch { /* não é arquivo do build */ }
  }
  if (pathname === '/robots.txt') return responderRobots(req, res);
  if (await responderSitemap(req, res, pathname)) return;
  try {
    await responderPagina(req, res, pathname, path.join(DIST, 'index.html'));
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
      const etag = etagDe(texto);
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
    if (redirecionarHost(req, res, url)) return;
    const geoMatch = url.pathname.match(/^\/api\/geo\/([a-z]{2})$/);
    if (geoMatch) {
      const alvo = geoMatch[1] === 'br' ? 'br' : validarUf(geoMatch[1]);
      const texto = await geo(alvo);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' });
      return res.end(texto);
    }
    const candMatch = url.pathname.match(/^\/api\/candidato\/(\d{1,15})$/);
    if (candMatch) {
      const data = await getCandidato(candMatch[1]);
      if (!data) return json(404, { erro: 'candidato não encontrado' });
      // A candidatura depende das flags (2º turno escondido, prévia por cookie): resposta privada.
      const candidatura = await candidaturaDe(candMatch[1], flagsDe(req)).catch(() => null);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=3600' });
      return res.end(JSON.stringify({ ...data, candidatura }));
    }
    if (url.pathname === '/api/preview') return rotaPreview(req, res, url);
    if (url.pathname === '/api/flags') return rotaFlags(req, res, url);
    const flags = flagsDe(req);
    if (url.pathname === '/api/ao-vivo') {
      if (!flags.aoVivo) return json(404, { erro: 'ao vivo desligado' });
      return assinar(req, res, await paramsResultado(url.searchParams, flags));
    }
    const rota = ROTAS_JSON[url.pathname];
    if (rota) return json(200, await rota(url.searchParams, flags));
    if (url.pathname.startsWith('/api/')) return json(404, { erro: 'rota inexistente' });
    return await estatico(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 502;
    if (status >= 500 && !err.silencioso) console.error(err); // falhas do TSE já saem resumidas no log
    return json(status, { erro: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`API em http://localhost:${PORT}${process.env.DEMO === '1' ? '  [MODO DEMO]' : ''}`);
});
