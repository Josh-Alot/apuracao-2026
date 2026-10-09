// Perfil e bens declarados dos candidatos (Dados Abertos do TSE), gerados por `npm run candidatos`.
// O arquivo (~17 MB descompactado, uma linha "sq<TAB>json" por candidato) só é lido no primeiro pedido;
// fica em memória como buffer + índice de deslocamentos, e cada pedido faz JSON.parse de uma linha só.

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ARQUIVO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dados', 'candidatos-2026.tsv.gz');
const NL = 0x0a, TAB = 0x09;

let carga = null;

async function ler() {
  // Síncrono de propósito: uma vez só (~50 ms) e sem os pedaços intermediários do gunzip assíncrono na memória.
  const buf = zlib.gunzipSync(await fs.readFile(ARQUIVO));
  const indice = new Map(); // sq → [início do json, fim da linha]
  let ini = buf.indexOf(NL);
  const gerado = buf.toString('utf8', 0, ini);
  while (ini !== -1 && ini < buf.length) {
    const fim = buf.indexOf(NL, ini + 1);
    const ate = fim === -1 ? buf.length : fim;
    const tab = buf.indexOf(TAB, ini + 1);
    indice.set(buf.toString('latin1', ini + 1, tab), [tab + 1, ate]);
    ini = fim;
  }
  return { buf, indice, gerado };
}

function carregar() {
  carga ??= ler().catch((err) => {
    carga = null; // tenta de novo no próximo pedido
    throw err;
  });
  return carga;
}

/** Dados do candidato pelo sequencial do TSE (`sqcand`), ou null se não existir. */
export async function getCandidato(sq) {
  const { buf, indice, gerado } = await carregar();
  const pos = indice.get(sq);
  return pos ? { ...JSON.parse(buf.toString('utf8', pos[0], pos[1])), gerado } : null;
}

/** Data em que o arquivo foi gerado ("dd/mm/aaaa hh:mm:ss"), para o lastmod do sitemap. */
export async function geradoEm() {
  return (await carregar()).gerado;
}
