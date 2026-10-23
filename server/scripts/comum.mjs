// O que os scripts de `npm run …` (candidatos, zonas, simular-2turno, arquivar, malhas) usam igual: opções da linha
// de comando, os zips dos Dados Abertos do TSE (cache em .cache/dados-abertos), o CSV do TSE e a gravação dos JSONs.
// Só roda na máquina de quem publica (usa o `unzip` do sistema); o servidor não importa este arquivo.

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE_DADOS_ABERTOS = path.join(ROOT, '.cache', 'dados-abertos');
const CDN_DADOS_ABERTOS = 'https://cdn.tse.jus.br/estatistica/sead/odsele';

const args = process.argv.slice(2);
/** Valor de `--<nome> <valor>` na linha de comando, ou undefined. */
export const opcao = (nome) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/**
 * Zip de um conjunto dos Dados Abertos (`<conjunto>_<ano>.zip`), em .cache/dados-abertos. Já baixado, é reusado
 * (apague o zip para baixar a versão nova), a não ser com `forcar` (conjuntos que o TSE atualiza, como os candidatos).
 */
export async function baixarDadosAbertos(conjunto, ano, { forcar = false } = {}) {
  const zip = path.join(CACHE_DADOS_ABERTOS, `${conjunto}_${ano}.zip`);
  if (!forcar) {
    try {
      await fs.access(zip);
      return zip;
    } catch { /* baixa */ }
  }
  console.log(`baixando ${conjunto}_${ano}.zip…`);
  const res = await fetch(`${CDN_DADOS_ABERTOS}/${conjunto}/${conjunto}_${ano}.zip`);
  if (!res.ok) throw new Error(`${conjunto}: HTTP ${res.status}`);
  await fs.mkdir(CACHE_DADOS_ABERTOS, { recursive: true });
  await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()));
  return zip;
}

/** Extrai um CSV do zip para .cache/dados-abertos e devolve o caminho dele. */
export function extrairCsv(zip, csv) {
  execFileSync('unzip', ['-oq', zip, csv, '-d', CACHE_DADOS_ABERTOS]);
  return path.join(CACHE_DADOS_ABERTOS, csv);
}

/** CSV do TSE: latin1, separador ";", campos entre aspas (às vezes os números sem). Devolve cabeçalho + linhas. */
export function lerCsv(buf) {
  const texto = new TextDecoder('latin1').decode(buf);
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ';') { linha.push(campo); campo = ''; }
    else if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (ch !== '\r') campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas;
  return { cab, col: Object.fromEntries(cab.map((k, i) => [k, i])), linhas: resto };
}

/** O mesmo CSV com cada linha como objeto (coluna → valor). */
export function lerCsvObjetos(buf) {
  const { cab, linhas } = lerCsv(buf);
  return linhas.map((l) => Object.fromEntries(cab.map((k, i) => [k, l[i]])));
}

/**
 * Grava `dado` em `destino` (URL): JSON em gzip (padrão) ou, com `gz: false`, JSON legível (manifestos). Passa por
 * um .tmp e renomeia, para um script interrompido não deixar arquivo pela metade. O gzip do Node não grava data no
 * cabeçalho: o mesmo conteúdo gera os mesmos bytes (git não vê mudança). Devolve o tamanho gravado.
 */
export async function gravarJson(destino, dado, { gz = true } = {}) {
  await fs.mkdir(new URL('.', destino), { recursive: true });
  const buf = gz ? zlib.gzipSync(JSON.stringify(dado), { level: 9 }) : Buffer.from(`${JSON.stringify(dado, null, 1)}\n`);
  const tmp = new URL(`${destino.href}.tmp`);
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, destino);
  return buf.length;
}
