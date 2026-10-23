// Regras da apuração sobre o JSON do TSE, em funções puras (sem cache nem rede; testadas em testes/servidor):
// normalização do resultado, situação do candidato, "matematicamente eleito", QE, suplência e puxadores, resumo do mapa.

import { fotoUrl } from './urls.mjs';
/** @import { Candidato, ParamsResultado, Resultado, Resumo } from '../../compartilhado/api.mjs' */

export const int = (s) => (s == null || s === '' ? 0 : parseInt(s, 10) || 0);
export const pct = (s) => (s == null || s === '' ? 0 : parseFloat(String(s).replace(',', '.')) || 0);

/**
 * Situação do candidato a partir do texto `st` do TSE. Não dá para confiar só em `e` ("s"/"n"):
 * quem vai ao 2º turno também vem com e = "s". Valores vistos nas eleições de 2024:
 * majoritário — "Eleito", "2º turno", "Não eleito";
 * proporcional — "Eleito por QP" (quociente partidário), "Eleito por média", "Suplente", "Não eleito".
 * Vazio = ainda indefinido (apuração em andamento). Textos desconhecidos seguem como "outro".
 */
/** @returns {{ status: Candidato['status'], detalhe: string | null }} */
export function classificar(st, e) {
  const t = (st || '').trim();
  if (!t) return { status: e === 's' ? 'eleito' : null, detalhe: null };
  if (/2.?\s*turno/i.test(t)) return { status: 'segundo-turno', detalhe: null };
  if (/^n[aã]o eleit/i.test(t)) return { status: 'nao-eleito', detalhe: null };
  if (/^eleit/i.test(t)) {
    const m = t.match(/por\s+(.+)$/i);
    return { status: 'eleito', detalhe: m ? `por ${m[1]}` : null };
  }
  if (/suplente/i.test(t)) return { status: 'suplente', detalhe: null };
  return { status: 'outro', detalhe: t };
}

/**
 * "Matematicamente eleito": mesmo que todos os eleitores das seções ainda não totalizadas (`e.esnt`)
 * votassem contra, o candidato não perde a vaga. Só vale no arquivo da disputa (BR para Presidente,
 * UF para os demais cargos). Conservador de propósito: votos anulados sub judice contam como se
 * fossem validados para os rivais, e no proporcional só entra a vaga pelo quociente partidário
 * (as sobras ficam de fora). No executivo também marca quem já tem o 2º turno garantido.
 * Devolve Map sqcand → 'eleito' | 'segundo-turno'.
 *
 * @param {Candidato[]} candidatos
 * @param {Grupos} grupos
 * @returns {Map<string, Candidato['matematicamente']>}
 */
export function situacaoMatematica(raw, candidatos, grupos) {
  const carg = raw.carg[0];
  const faltam = int(raw.e?.esnt);
  const validos = int(raw.v?.vv);
  const subJudice = int(raw.v?.vansj);
  const vagas = int(carg.nv) || 1;
  const out = new Map();
  const podeSerEleito = (c) => c.votos > 0 && c.destinoVotos === 'Válido';

  if (carg.cd === '1' || carg.cd === '3') {
    // Presidente e Governador: maioria absoluta dos votos válidos no 1º turno.
    const tetoValidos = validos + subJudice + faltam;
    for (const c of candidatos) if (podeSerEleito(c) && 2 * c.votos > tetoValidos) out.set(c.sq, 'eleito');
    // No 2º turno não há outro turno a garantir: só a maioria absoluta acima conta.
    if (out.size || raw.t === '2') return out;

    // 2º turno garantido: (1) ninguém mais pode ter maioria — dando a cada um todos os votos que
    // faltam (que também entram nos válidos); um sub judice validado soma os votos dele aos válidos —
    // e (2) o candidato fica entre os 2 primeiros: cada eleitor vota uma vez, então os dois rivais
    // mais próximos precisariam, juntos, de mais votos do que faltam. Empate conta como ameaça.
    const alguemPodeVencer = candidatos.some((c) => (c.destinoVotos === 'Válido'
      ? 2 * c.votos + faltam > validos
      : c.votos + faltam > validos));
    if (alguemPodeVencer) return out;
    for (const c of candidatos) {
      if (!podeSerEleito(c)) continue;
      const [a = Infinity, b = Infinity] = candidatos.filter((o) => o !== c)
        .map((o) => Math.max(0, c.votos - o.votos)).sort((x, y) => x - y);
      if (a + b > faltam) out.set(c.sq, 'segundo-turno');
    }
  } else if (carg.cd === '5') {
    // Senado: os `vagas` mais votados. Cada eleitor dá no máximo 1 voto a cada candidato, então
    // cada rival pode receber até `faltam` votos. Empate conta como ameaça (desempate é por idade).
    for (const c of candidatos) {
      if (!podeSerEleito(c)) continue;
      const ameacas = candidatos.filter((o) => o !== c && o.votos + faltam >= c.votos).length;
      if (ameacas < vagas) out.set(c.sq, 'eleito');
    }
  } else {
    // Proporcional (só a vaga pelo quociente partidário). O adversário divide os votos que faltam:
    // os que vão para outras agremiações aumentam o QE; os que vão para colegas de chapa os põem à
    // frente, mas também somam ao partido. Com o QE no máximo possível, as vagas por QP são no mínimo
    // floor((votos do grupo + y) / QE máx.) quando y votos vão para colegas. Basta testar y = 0 e
    // os pontos em que mais um colega alcança o candidato (soma das menores diferenças).
    const teto = validos + subJudice + faltam;
    const qeMax = Math.ceil(teto / vagas) + 1; // o TSE arredonda o QE; +1 cobre o arredondamento
    const doGrupo = new Map(); // agremiação → índices dos candidatos
    grupos.agrDe.forEach((agr, i) => {
      if (!doGrupo.has(agr)) doGrupo.set(agr, []);
      doGrupo.get(agr).push(i);
    });
    candidatos.forEach((c, i) => {
      if (!podeSerEleito(c) || c.votos < 0.1 * qeMax) return; // mínimo de 10% do QE
      const agr = grupos.agrDe[i];
      const total = grupos.get(agr);
      const diferencas = doGrupo.get(agr).filter((j) => j !== i)
        .map((j) => Math.max(0, c.votos - candidatos[j].votos)) // empate conta como "à frente"
        .sort((a, b) => a - b);
      let y = 0;
      for (let k = 0; k <= diferencas.length; k++) {
        // k colegas à frente custam y votos; o candidato precisa de mais de k vagas.
        if (k > 0) y += diferencas[k - 1];
        if (y > faltam) break;
        if (Math.floor((total + y) / qeMax) <= k) return;
      }
      out.set(c.sq, 'eleito');
    });
  }
  return out;
}

/**
 * QE (Código Eleitoral, art. 106): votos válidos (nominais + legenda) ÷ vagas, desprezada a fração
 * igual ou inferior a meio e arredondada para 1 a superior. Em inteiros, porque `Math.round` sobe o
 * meio exato. Só é usado se o arquivo do TSE não trouxer `carg.qe`.
 */
export function quocienteEleitoral(validos, vagas) {
  const q = Math.floor(validos / vagas);
  return 2 * (validos - q * vagas) > vagas ? q + 1 : q;
}

/**
 * Proporcional: ordem de suplência na chapa (partido isolado ou federação) e o "efeito puxador" —
 * eleito com menos votos que o quociente eleitoral (QE), numa chapa em que alguém passou do QE
 * (o puxador). Com a situação oficial do TSE (`st`) usa eleitos e suplentes oficiais; antes dela,
 * projeta pelas vagas que o TSE calcula para cada chapa (`agr.vag`): ficam com elas os mais votados
 * da chapa com ao menos 10% do QE. Suplência = demais candidatos com votos válidos, por votos.
 * Devolve Map sqcand → { suplente, puxadoPor, puxou, qe, projecao }.
 *
 * @param {Candidato[]} candidatos
 * @param {Grupos} grupos
 * @returns {Map<string, Candidato['chapa']>}
 */
export function chapas(raw, candidatos, grupos) {
  const carg = raw.carg[0];
  const out = new Map();
  const qe = int(carg.qe) || quocienteEleitoral(int(raw.v?.vv), int(carg.nv) || 1);
  if (!qe) return out;
  const oficial = candidatos.some((c) => c.status === 'eleito' || c.status === 'suplente');
  const porChapa = new Map(); // agremiação → candidatos
  candidatos.forEach((c, i) => {
    const agr = grupos.agrDe[i];
    if (!porChapa.has(agr)) porChapa.set(agr, []);
    porChapa.get(agr).push(c);
  });
  for (const [agr, cs] of porChapa) {
    const validos = cs.filter((c) => c.destinoVotos === 'Válido' && c.votos > 0).sort((a, b) => b.votos - a.votos);
    let eleitos;
    let suplentes;
    if (oficial) {
      eleitos = validos.filter((c) => c.status === 'eleito');
      suplentes = validos.filter((c) => c.status === 'suplente');
    } else {
      eleitos = validos.filter((c) => c.votos >= 0.1 * qe).slice(0, int(agr.vag));
      suplentes = validos.filter((c) => !eleitos.includes(c));
    }
    const puxador = eleitos.find((c) => c.votos >= qe); // eleitos em ordem de votos: o mais votado
    const puxados = puxador ? eleitos.filter((c) => c.votos < qe) : [];
    const base = { suplente: null, puxadoPor: null, puxou: 0, qe, projecao: !oficial };
    for (const c of eleitos) {
      out.set(c.sq, { ...base, puxadoPor: puxados.includes(c) ? puxador.nomeUrna : null, puxou: c === puxador ? puxados.length : 0 });
    }
    suplentes.forEach((c, k) => out.set(c.sq, { ...base, suplente: k + 1 }));
  }
  return out;
}

const PROPORCIONAIS = new Set(['6', '7', '8']);

/** Abrangência em que a disputa é decidida: Brasil para Presidente, UF para os demais cargos. */
export const escopoDaDisputa = (cargo) => (String(cargo) === '1' ? 'br' : 'uf');

/**
 * Agremiação (partido isolado ou federação, objeto `agr` do TSE) → total dela (nominais + legenda), e `agrDe[i]` = a
 * agremiação do i-ésimo candidato.
 * @typedef {Map<any, number> & { agrDe: any[] }} Grupos
 */

/**
 * @param {any} raw JSON do TSE
 * @param {Pick<ParamsResultado, 'eleicao' | 'uf'>} params
 * @returns {Resultado}
 */
export function normalizar(raw, { eleicao, uf }) {
  const carg = raw.carg[0];
  const fotoUf = carg.cd === '1' ? 'br' : uf;
  /** @type {Candidato[]} */
  const candidatos = [];
  /** @type {Grupos} */
  const grupos = Object.assign(new Map(), { agrDe: [] });
  for (const agr of carg.agr ?? []) {
    grupos.set(agr, (agr.par ?? []).reduce((t, par) => t + int(par.tvtn) + int(par.tvtl), 0));
    for (const par of agr.par ?? []) {
      for (const c of par.cand ?? []) {
        grupos.agrDe.push(agr);
        candidatos.push({
          numero: c.n,
          sq: c.sqcand,
          nome: c.nm,
          nomeUrna: c.nmu,
          partido: par.sg,
          coligacao: agr.tp === 'c' ? agr.com : null,
          votos: int(c.vap),
          pct: pct(c.pvap),
          ...classificar(c.st, c.e),
          situacao: c.st || null,
          // Para onde vão os votos: "Válido", "Válido (legenda)", "Anulado", "Anulado sub judice".
          destinoVotos: c.dvt || null,
          vices: (c.vs ?? []).map((v) => ({ tipo: v.tp, sq: v.sqcand, nome: v.nmu, partido: v.sgp, foto: fotoUrl(eleicao, fotoUf, v.sqcand) })),
          foto: fotoUrl(eleicao, fotoUf, c.sqcand),
          matematicamente: null,
          chapa: null,
        });
      }
    }
  }
  if (raw.tpabr === escopoDaDisputa(carg.cd)) {
    const situacao = situacaoMatematica(raw, candidatos, grupos);
    for (const c of candidatos) c.matematicamente = situacao.get(c.sq) ?? null;
    if (PROPORCIONAIS.has(carg.cd)) {
      const chapa = chapas(raw, candidatos, grupos);
      for (const c of candidatos) c.chapa = chapa.get(c.sq) ?? null;
    }
  }
  candidatos.sort((a, b) => b.votos - a.votos || a.nomeUrna.localeCompare(b.nomeUrna, 'pt-BR'));

  const s = raw.s ?? {};
  const e = raw.e ?? {};
  const v = raw.v ?? {};
  return {
    cargo: { cd: carg.cd, nome: carg.nmn, vagas: int(carg.nv) },
    abrangencia: { tipo: raw.tpabr, cd: raw.cdabr },
    atualizado: raw.dg ? `${raw.dg} ${raw.hg}` : null,
    totalizado: raw.tf === 's',
    secoes: { total: int(s.ts), totalizadas: int(s.st), pct: pct(s.pst) },
    eleitorado: {
      total: int(e.te),
      comparecimento: int(e.c),
      pctComparecimento: pct(e.pc),
      abstencao: int(e.a),
      pctAbstencao: pct(e.pa),
    },
    votos: {
      total: int(v.tv),
      validos: int(v.vv),
      pctValidos: pct(v.pvv),
      brancos: int(v.vb),
      pctBrancos: pct(v.pvb),
      nulos: int(v.tvn),
      pctNulos: pct(v.ptvn),
    },
    candidatos,
  };
}

const resumoCand = (c) => (c && c.votos > 0
  ? { numero: c.numero, nome: c.nomeUrna, partido: c.partido, pct: c.pct, votos: c.votos }
  : null);

/**
 * Resumo enxuto usado para colorir o mapa: líder e 2º colocado (o mapa pinta pela vantagem; a lateral mostra a
 * diferença por UF e as disputas apertadas) e o eleitorado (maiores eleitorados). No 2º turno (com `r1`, o
 * resultado do 1º turno na mesma região) traz também se a região "virou": quem lidera agora ficou atrás do rival
 * no 1º turno (entre os dois finalistas).
 *
 * @param {Resultado | null | undefined} r
 * @param {Resultado | null} [r1]
 * @returns {Resumo | null}
 */
export function resumo(r, r1) {
  if (!r) return null;
  const lider = resumoCand(r.candidatos[0]);
  const segundo = lider ? resumoCand(r.candidatos[1]) : null;
  const out = { pctApurado: r.secoes.pct, eleitorado: r.eleitorado.total, lider, segundo };
  if (r1 === undefined) return out;
  const antes = (n) => r1?.candidatos.find((c) => c.numero === n)?.votos ?? 0;
  out.virou = !!(lider && segundo && r1 && antes(segundo.numero) > antes(lider.numero));
  return out;
}
