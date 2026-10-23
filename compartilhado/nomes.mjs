// Nomes como aparecem na tela e no <title>, compartilhados entre o front (lib/util.ts, dominio/cargo.ts) e o
// servidor (seo.mjs): o título que o servidor injeta tem de bater com o que o front monta depois.
// JavaScript puro para o Node importar sem build; os tipos estão em nomes.d.mts.

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', "d'"]);

/** "SÃO JOSÉ DOS CAMPOS" → "São José dos Campos" */
export function titulo(s) {
  return String(s)
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** Nome do cargo sem o turno: "Governador (2º turno)" → "Governador". */
export const cargoBase = (c) => c.nome.replace(/\s*\(\d+º turno\)$/, '');

/** Nome do cargo como no <title>: "Governador", "Presidente 2º turno". */
export const nomeCargo = (c) => (c.turno === 2 ? `${cargoBase(c)} 2º turno` : cargoBase(c));
