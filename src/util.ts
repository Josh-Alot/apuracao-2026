const nf = new Intl.NumberFormat('pt-BR');
const pf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = (n: number) => nf.format(n);
export const fmtPct = (n: number) => `${pf.format(n)}%`;
const rf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtReais = (n: number) => rf.format(n);

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

/** "SUPERIOR COMPLETO" → "Superior completo" */
export const frase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Cores das identidades visuais, conforme as predefinições "<partido>/meta/cor" da Wikipédia lusófona
// (as mesmas usadas nos mapas eleitorais da imprensa). As chaves são as siglas como o TSE as escreve
// (campo "sg"; federações não aparecem, cada candidato vem com o próprio partido). Siglas fora da
// lista recebem uma cor estável por hash.
const CORES_PARTIDO: Record<string, string> = {
  PT: '#c0122d', PCDOB: '#800314', PV: '#01652f', PSB: '#ffcc00', PDT: '#fe8e6d', PSOL: '#68018d',
  REDE: '#3ca08c', PL: '#30306c', PSD: '#ffa400', MDB: '#009959', PSDB: '#0f2bc5', CIDADANIA: '#ec008c',
  UNIÃO: '#00a0df', PP: '#54b8ea', REPUBLICANOS: '#005ca9', NOVO: '#ec671c', PODE: '#00d663',
  AVANTE: '#2eabb1', SOLIDARIEDADE: '#f37021', PRD: '#007c3c', MISSÃO: '#fcbe26', DC: '#c89721',
  DEMOCRATA: '#3da564', AGIR: '#01369e', PRTB: '#0047ab', PMB: '#8e2a4e', PCO: '#9f030a',
  PSTU: '#c92127', PCB: '#a8231c', UP: '#000000',
  MOBILIZA: '#5d4037', // sem predefinição na Wikipédia
};

/** Siglas conhecidas, para o filtro de partido da busca antes de o índice do servidor responder. */
export const PARTIDOS = Object.keys(CORES_PARTIDO);

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

/** Matiz (0–360) de "#rrggbb"; null para outras notações (cores por hash, em hsl). */
function matiz(cor: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cor);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Distância entre matizes (0–180): azul-claro × azul-escuro dá perto de 0, mesmo com brilhos diferentes. */
function distancia(a: string, b: string) {
  const x = matiz(a);
  const y = matiz(b);
  if (x == null || y == null) return 180;
  const d = Math.abs(x - y);
  return Math.min(d, 360 - d);
}

// Alternativas para o 2º finalista quando os dois partidos têm cores parecidas (ex.: PP × Republicanos).
const CORES_RESERVA = ['#d97706', '#7c3aed', '#0f766e', '#be185d'];

/**
 * Cores dos dois finalistas do 2º turno: a de cada partido, a não ser que fiquem parecidas demais
 * para distinguir no mapa (mesma família de matiz) — aí o segundo recebe a reserva mais distante.
 */
export function coresDuelo(a: string, b: string): [string, string] {
  const ca = corPartido(a);
  const cb = corPartido(b);
  if (distancia(ca, cb) >= 40) return [ca, cb];
  const alternativa = [...CORES_RESERVA].sort((x, y) => distancia(ca, y) - distancia(ca, x))[0];
  return [ca, alternativa];
}
