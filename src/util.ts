const nf = new Intl.NumberFormat('pt-BR');
const pf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = (n: number) => nf.format(n);
export const fmtPct = (n: number) => `${pf.format(n)}%`;

export const UF_NOMES: Record<string, string> = {
  ac: 'Acre', al: 'Alagoas', ap: 'Amapá', am: 'Amazonas', ba: 'Bahia', ce: 'Ceará',
  df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mt: 'Mato Grosso',
  ms: 'Mato Grosso do Sul', mg: 'Minas Gerais', pa: 'Pará', pb: 'Paraíba', pr: 'Paraná',
  pe: 'Pernambuco', pi: 'Piauí', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte',
  rs: 'Rio Grande do Sul', ro: 'Rondônia', rr: 'Roraima', sc: 'Santa Catarina', sp: 'São Paulo',
  se: 'Sergipe', to: 'Tocantins', zz: 'Exterior',
};

/** "SÃO JOSÉ DOS CAMPOS" → "São José dos Campos" */
export function titulo(s: string) {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', "d'"]);
  return s
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

export const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Cores aproximadas das identidades visuais dos partidos; o resto recebe uma cor estável por hash.
const CORES_PARTIDO: Record<string, string> = {
  PT: '#c4161c', 'PT/PC do B/PV': '#c4161c', 'PC do B': '#a50f15', PV: '#2e9e44',
  PL: '#1f3f99', PSD: '#f2a900', MDB: '#2b7a3d', PSDB: '#1565c0', 'PSDB/CIDADANIA': '#1565c0',
  UNIÃO: '#0a2c74', 'UNIÃO PROGRESSISTA': '#0a2c74', PP: '#5aa1e3', REPUBLICANOS: '#0071bc',
  PSB: '#e4572e', PDT: '#d1495b', NOVO: '#f37021', PSOL: '#7b1fa2', 'PSOL/REDE': '#7b1fa2',
  REDE: '#16a085', PODE: '#29b6f6', AVANTE: '#00897b', SOLIDARIEDADE: '#ef6c00', PRD: '#283593',
  CIDADANIA: '#e91e63', DC: '#6d4c41', MISSÃO: '#455a64', DEMOCRATA: '#00838f', PCO: '#8b0000',
  PSTU: '#b71c1c', UP: '#880e4f', PMB: '#ad1457', AGIR: '#00695c', MOBILIZA: '#5d4037', PCB: '#d50000',
};

export function corPartido(sigla: string | undefined | null): string {
  if (!sigla) return '#9aa3ad';
  if (CORES_PARTIDO[sigla]) return CORES_PARTIDO[sigla];
  let h = 0;
  for (const ch of sigla) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}

/** Escala sequencial para o modo "% apurado" (0 → claro, 100 → verde escuro). */
export function corApuracao(pct: number): string {
  const t = Math.max(0, Math.min(1, pct / 100));
  const l = 92 - t * 62;
  return `hsl(158 ${35 + t * 45}% ${l}%)`;
}
