// Gera dados/malhas/<alvo>.json.gz: as malhas do IBGE que o mapa usa (Brasil por UF e cada UF por município),
// versionadas para o servidor não depender do IBGE nem do disco do Render (apagado a cada reinício e deploy).
// Rodar com `npm run malhas` (opções `--uf sp,rj` e `--br` para escolher; `--forcar` baixa de novo do IBGE em vez
// de usar a cópia em .cache/geo). A malha muda raramente: rode de novo antes de outra eleição e faça commit.
// Depois de mudar uma malha, rode também `npm run zonas`: o contorno das zonas é recortado por ela.

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { ALVOS, DIR_MALHAS, baixarMalha, guardarEmCache, malhaEmCache } from '../malhas.mjs';
import { opcao } from './comum.mjs';

const args = process.argv.slice(2);
const forcar = args.includes('--forcar');
const escolhidos = [...(opcao('uf')?.toLowerCase().split(',') ?? []), ...(args.includes('--br') ? ['br'] : [])];
const alvos = escolhidos.length ? escolhidos : ALVOS;

const invalidos = alvos.filter((a) => !ALVOS.includes(a));
if (invalidos.length) {
  console.error(`Malha desconhecida: ${invalidos.join(', ')}`);
  process.exit(1);
}

await fs.mkdir(DIR_MALHAS, { recursive: true });
let falhas = 0;
for (const alvo of alvos) {
  try {
    let texto = forcar ? undefined : await malhaEmCache(alvo);
    const origem = texto === undefined ? 'IBGE' : '.cache/geo';
    if (texto === undefined) {
      const data = await baixarMalha(alvo);
      if (!data) throw new Error('o IBGE não tem esta malha (404)');
      texto = JSON.stringify(data);
      await guardarEmCache(alvo, texto);
    }
    const data = JSON.parse(texto);
    const chave = alvo === 'br' ? 'uf' : 'ibge';
    if (data.type !== 'FeatureCollection' || !data.features?.length || data.features.some((f) => !f.properties?.[chave])) {
      throw new Error(`malha inválida (FeatureCollection com \`${chave}\` em cada região)`);
    }
    // gzip sem data no cabeçalho: malha sem mudança não gera diff no git.
    const gz = zlib.gzipSync(texto, { level: 9 });
    await fs.writeFile(path.join(DIR_MALHAS, `${alvo}.json.gz`), gz);
    console.log(`${alvo}: ${data.features.length} regiões, ${(gz.length / 1024).toFixed(0)} KB (de ${origem})`);
  } catch (err) {
    falhas++;
    console.error(`${alvo}: FALHOU — ${err.message}`);
  }
}
if (falhas) {
  console.error(`${falhas} malha(s) com falha; as demais foram gravadas.`);
  process.exit(1);
}
