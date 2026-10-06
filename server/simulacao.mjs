// Simulação do 2º turno (pasta simulacao/, gerada por `npm run simular-2turno`): votos do 2º turno de
// 2022 aplicados aos candidatos que foram ao 2º turno de 2026, no formato do arquivo próprio.
//
// Só vale com SIMULACAO_2TURNO=1. Ligada, o pleito simulado entra na configuração geral do TSE (as
// eleições 6258/6260, com os mesmos códigos que o TSE vai usar) e os arquivos dessas eleições saem da
// pasta simulacao/, nunca do TSE — mesmo depois que o TSE publicar o 2º turno: desligue a variável.

import fs from 'node:fs';

export const SIMULACAO = process.env.SIMULACAO_2TURNO === '1';
export const RAIZ_SIMULACAO = new URL('../simulacao/', import.meta.url);

let def;
/** simulacao.json (pleito a acrescentar e de onde vêm as fotos), ou null se desligada/ausente. */
function definicao() {
  if (def !== undefined) return def;
  def = null;
  if (!SIMULACAO) return def;
  try {
    def = JSON.parse(fs.readFileSync(new URL('ele2026-2turno/simulacao.json', RAIZ_SIMULACAO), 'utf8'));
  } catch {
    console.warn('SIMULACAO_2TURNO=1, mas simulacao/ele2026-2turno/simulacao.json não existe: rode `npm run simular-2turno`.');
  }
  return def;
}

export const eleicoesSimuladas = () => new Set(definicao()?.pleito.e.map((e) => e.cd) ?? []);

/** Eleição cujas fotos usar: o TSE só publica as do 2º turno quando ele existir; até lá, as do 1º. */
export const eleicaoDaFoto = (eleicao) => definicao()?.fotos[eleicao] ?? eleicao;

const mescladas = new WeakMap();
let avisou = false;
/**
 * ele-c.json do TSE com o pleito simulado. Se o TSE já publicou essas eleições, as dele saem da
 * configuração (a simulação manda enquanto a variável estiver ligada). Memorizado por objeto, para
 * `getConfig()` continuar remontando só quando o JSON do TSE muda.
 */
export function mesclarConfig(raw) {
  const d = definicao();
  if (!d || !raw) return raw;
  if (mescladas.has(raw)) return mescladas.get(raw);
  const simuladas = eleicoesSimuladas();
  const pl = raw.pl
    .map((p) => ({ ...p, e: p.e.filter((e) => !simuladas.has(e.cd)) }))
    .filter((p) => p.e.length);
  if (!avisou && pl.reduce((n, p) => n + p.e.length, 0) < raw.pl.reduce((n, p) => n + p.e.length, 0)) {
    avisou = true;
    console.warn('O TSE já publicou o 2º turno, mas SIMULACAO_2TURNO=1 mantém a simulação no lugar.');
  }
  const out = { ...raw, pl: [...pl, d.pleito] };
  mescladas.set(raw, out);
  return out;
}
