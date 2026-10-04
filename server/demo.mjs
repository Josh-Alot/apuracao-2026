// Modo demonstração (DEMO=1): preenche os arquivos reais do TSE (candidatos reais,
// votos zerados antes da apuração) com votos sintéticos determinísticos que "avançam"
// ao longo de DEMO_MINUTOS, para testar a interface sem esperar o fechamento das urnas.

const INICIO = Date.now();
const DURACAO_MS = Number(process.env.DEMO_MINUTOS || 15) * 60_000;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

const fmtPct = (n) => n.toFixed(2).replace('.', ',');

/** Fração (0–1) de seções "apuradas" numa região, crescendo com o tempo. */
export function demoProgresso(regiao) {
  return Math.min(1, (Date.now() - INICIO) / DURACAO_MS + hash(regiao) * 0.15);
}

export function applyDemo(raw) {
  const regiao = `${raw.tpabr}:${raw.cdabr}`;
  const progresso = demoProgresso(regiao);
  const out = structuredClone(raw);

  const ts = parseInt(out.s?.ts ?? '0', 10);
  const st = Math.round(ts * progresso);
  if (out.s) Object.assign(out.s, { st: String(st), pst: fmtPct(ts ? (st / ts) * 100 : 0) });

  const eleitorado = parseInt(out.e?.te ?? '0', 10);
  const comparecimento = Math.round(eleitorado * 0.8 * progresso);
  if (out.e) {
    const totalizado = Math.round(eleitorado * progresso);
    Object.assign(out.e, {
      est: String(totalizado),
      esnt: String(eleitorado - totalizado),
      c: String(comparecimento),
      pc: fmtPct(eleitorado ? (comparecimento / eleitorado) * 100 : 0),
      a: String(Math.round(eleitorado * 0.2 * progresso)),
      pa: fmtPct(progresso ? 20 : 0),
    });
  }
  const validos = Math.round(comparecimento * 0.92);
  const brancos = Math.round(comparecimento * 0.03);
  const nulos = comparecimento - validos - brancos;
  if (out.v) {
    const p = (n) => fmtPct(comparecimento ? (n / comparecimento) * 100 : 0);
    Object.assign(out.v, {
      tv: String(comparecimento), vv: String(validos), pvv: p(validos),
      vb: String(brancos), pvb: p(brancos), tvn: String(nulos), ptvn: p(nulos),
    });
  }

  for (const carg of out.carg ?? []) {
    const cands = carg.agr.flatMap((a) => a.par.flatMap((p) => p.cand));
    // Peso global do candidato (forte) × variação regional (fraca) → líderes mudam por região.
    const pesos = cands.map((c) => Math.pow(hash(c.sqcand), 4) * (0.6 + hash(c.sqcand + regiao)));
    const soma = pesos.reduce((a, b) => a + b, 0) || 1;
    cands.forEach((c, i) => {
      const votos = Math.round((validos * pesos[i]) / soma);
      c.vap = String(votos);
      c.pvap = fmtPct(validos ? (votos / validos) * 100 : 0);
    });
  }
  return out;
}
