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
  return hslHex(h % 360, 0.55, 0.45);
}

// ---------- cores por tema ----------

/** Cores fixas dos tokens do tema (as mesmas do styles.css), para misturar no SVG sem depender de var(). */
export const TOKENS = {
  claro: { superficie: '#eae8e2', texto: '#141413', semDado: '#dcd9d1' },
  escuro: { superficie: '#1a1917', texto: '#ede8dd', semDado: '#2a2825' },
} as const;

type Rgb = [number, number, number];

function hslHex(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgbHex([f(0), f(8), f(4)]);
}

function hexRgb(cor: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cor);
  return m ? [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255) as Rgb : null;
}

const rgbHex = (c: Rgb) =>
  `#${c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('')}`;

const linear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const gama = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function paraOklch([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function deOklch([L, C, h]: Rgb): Rgb {
  // Reduz o croma até a cor caber no sRGB (clarear um azul-marinho saturado sairia da gama).
  for (let c = C; ; c *= 0.95) {
    const A = c * Math.cos(h);
    const B = c * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb: Rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707542455 * s,
    ];
    if (rgb.every((x) => x >= -1e-4 && x <= 1 + 1e-4) || c < 1e-3) return rgb.map(gama) as Rgb;
  }
}

/** Mesma cor com a luminosidade OKLCH limitada a [min, max]. Notação desconhecida volta como veio. */
function luminosidade(cor: string, min: number, max: number) {
  const rgb = hexRgb(cor);
  if (!rgb) return cor;
  const [L, C, h] = paraOklch(rgb);
  const alvo = Math.max(min, Math.min(max, L));
  return Math.abs(alvo - L) < 1e-3 ? cor : rgbHex(deOklch([alvo, C, h]));
}

/** Cor quase sem croma (o preto da UP): no escuro vira a cor do texto em vez de um cinza. */
const neutra = (cor: string) => {
  const rgb = hexRgb(cor);
  return !!rgb && paraOklch(rgb)[1] < 0.02;
};

/**
 * Preenchimento (mapa, barras, filetes) de uma cor de partido no tema: no escuro, as cores muito escuras
 * (PL, UP) sobem até L 0,62 para não sumirem no fundo; no claro ficam as originais.
 */
export function corPreenchimento(cor: string, escuro: boolean) {
  if (!escuro) return cor;
  return neutra(cor) ? TOKENS.escuro.texto : luminosidade(cor, 0.62, 1);
}

/** Texto colorido (ticker, diferença por UF): L ≥ 0,74 no escuro e ≤ 0,5 no claro, para ler sobre o fundo. */
export function corTexto(cor: string, escuro: boolean) {
  if (escuro) return neutra(cor) ? TOKENS.escuro.texto : luminosidade(cor, 0.74, 1);
  return luminosidade(cor, 0, 0.5);
}

/** `cor` a `t` (0–1) misturada com `fundo`, em sRGB (o mesmo que color-mix(in srgb, …)). */
export function misturar(cor: string, fundo: string, t: number) {
  const a = hexRgb(cor);
  const b = hexRgb(fundo);
  if (!a || !b) return cor;
  return rgbHex(a.map((x, i) => b[i] + (x - b[i]) * t) as Rgb);
}

/** Escala do modo "% apurado": do "sem dado" do tema até a cor do texto (sem matiz; cor fica para os partidos). */
export function corApuracao(pct: number, escuro: boolean): string {
  const t = Math.max(0, Math.min(1, pct / 100));
  const tk = escuro ? TOKENS.escuro : TOKENS.claro;
  return misturar(tk.texto, tk.semDado, 0.12 + 0.88 * t);
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
