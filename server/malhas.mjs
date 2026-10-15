// Malhas do IBGE (contorno do Brasil por UF e de cada UF por município), usadas pelo mapa e pelo `npm run zonas`.
// Fonte principal: dados/malhas/<alvo>.json.gz, versionado (`npm run malhas`). O disco do Render é apagado a cada
// reinício e deploy, então depender só do IBGE em produção deixava o mapa fora do ar quando o IBGE falhava.
// O IBGE fica de reserva (UF que faltar na pasta), com cópia em .cache/geo.

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_MALHAS = path.join(ROOT, 'dados', 'malhas');
const GEO_CACHE = path.join(ROOT, '.cache', 'geo');

export const IBGE_UF = {
  11: 'ro', 12: 'ac', 13: 'am', 14: 'rr', 15: 'pa', 16: 'ap', 17: 'to', 21: 'ma', 22: 'pi',
  23: 'ce', 24: 'rn', 25: 'pb', 26: 'pe', 27: 'al', 28: 'se', 29: 'ba', 31: 'mg', 32: 'es',
  33: 'rj', 35: 'sp', 41: 'pr', 42: 'sc', 43: 'rs', 50: 'ms', 51: 'mt', 52: 'go', 53: 'df',
};
/** Todas as malhas: o Brasil (por UF) e cada UF (por município). */
export const ALVOS = ['br', ...Object.values(IBGE_UF).sort()];

const TIMEOUT_MS = 20_000;

// Desde outubro de 2026 o servidor do IBGE envia o certificado sem a CA intermediária da Sectigo: o navegador
// completa a cadeia sozinho, o Node não (UNABLE_TO_VERIFY_LEAF_SIGNATURE). A intermediária vai junto das raízes
// do Node só nestas consultas, sem afrouxar a verificação.
const CA_IBGE = [...tls.rootCertificates, readFileSync(path.join(ROOT, 'server', 'certs', 'sectigo-dv-r36.pem'), 'utf8')];

export const urlMalha = (alvo) => (alvo === 'br'
  ? 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF'
  : `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${alvo.toUpperCase()}?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio`);

/** GET com a CA do IBGE (o `fetch` global não aceita CA própria sem o undici). Resolve { status, corpo }. */
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca: CA_IBGE, headers: { 'user-agent': 'apuracao-2026/0.1' }, timeout: TIMEOUT_MS }, (res) => {
      const partes = [];
      res.on('data', (p) => partes.push(p));
      res.on('end', () => resolve({ status: res.statusCode, corpo: Buffer.concat(partes).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`sem resposta em ${TIMEOUT_MS / 1000} s`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

/**
 * Baixa a malha do IBGE e troca as propriedades pelo que o app usa (`uf` no Brasil, `ibge` = código do município).
 * Devolve null se o IBGE não tem a malha (404); erro de rede/HTTP sai com `code` (certificado, DNS…) na mensagem.
 */
export async function baixarMalha(alvo) {
  let r;
  try {
    r = await get(urlMalha(alvo));
  } catch (err) {
    throw new Error(err.code || err.message);
  }
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const data = JSON.parse(r.corpo);
  for (const f of data.features) {
    const cod = f.properties.codarea;
    f.properties = alvo === 'br' ? { uf: IBGE_UF[cod] } : { ibge: cod };
  }
  return data;
}

/** Malha versionada em dados/malhas (texto do JSON), ou undefined se não há. */
export async function malhaVersionada(alvo) {
  try {
    return zlib.gunzipSync(await fs.readFile(path.join(DIR_MALHAS, `${alvo}.json.gz`))).toString('utf8');
  } catch {
    return undefined;
  }
}

/** Cópia local da malha baixada do IBGE (.cache/geo), ou undefined. */
export async function malhaEmCache(alvo) {
  try {
    return await fs.readFile(path.join(GEO_CACHE, `${alvo}.json`), 'utf8');
  } catch {
    return undefined;
  }
}

export async function guardarEmCache(alvo, texto) {
  await fs.mkdir(GEO_CACHE, { recursive: true });
  await fs.writeFile(path.join(GEO_CACHE, `${alvo}.json`), texto);
}

/**
 * Texto do JSON da malha: dados/malhas, senão .cache/geo, senão o IBGE (guardado em .cache/geo).
 * Devolve null se o IBGE não tem a malha; falha do IBGE sobe como erro.
 */
export async function lerMalha(alvo) {
  const local = (await malhaVersionada(alvo)) ?? (await malhaEmCache(alvo));
  if (local !== undefined) return local;
  const data = await baixarMalha(alvo);
  if (!data) return null;
  const texto = JSON.stringify(data);
  await guardarEmCache(alvo, texto);
  return texto;
}
