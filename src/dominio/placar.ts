import type { Candidato, Cargo, Local, MapaDados, Resultado, Resumo } from '../lib/types';
import { corPartido } from '../lib/util';

export interface Placar {
  par: [Candidato, Candidato];
  cores: [string, string];
}

/**
 * Placar: os dois da frente nos cargos majoritários (no 2º turno, os finalistas na ordem do número de urna, com as
 * cores do duelo). null nos proporcionais e com menos de dois candidatos.
 */
export function placarDe(
  cargo: Cargo, r: Resultado | null, finalistas: [Candidato, Candidato] | null, coresDuelo: Map<string, string> | null,
): Placar | null {
  if (cargo.tipo !== 'majoritario' || !r || r.candidatos.length < 2) return null;
  const par = cargo.turno === 2 ? finalistas : [r.candidatos[0], r.candidatos[1]] as [Candidato, Candidato];
  if (!par) return null;
  const cores: [string, string] = cargo.turno === 2 && coresDuelo
    ? [coresDuelo.get(par[0].numero)!, coresDuelo.get(par[1].numero)!]
    : [corPartido(par[0].partido), corPartido(par[1].partido)];
  return { par, cores };
}

/** Regiões contadas no placar e na ficha: UFs no Brasil, municípios na UF (cidades no exterior), zonas no município. */
export function rotuloRegioesVencidas(local: Local) {
  if (local.zona) return null;
  if (local.mun) return 'zonas';
  if (local.uf) return local.uf === 'zz' ? 'cidades' : 'municípios';
  return 'UFs';
}

/** Quantas regiões o candidato (pelo número) lidera. */
export const regioesVencidas = (dados: MapaDados | null | undefined, numero: string) =>
  Object.values(dados ?? {}).filter((x) => x?.lider?.numero === numero).length;

/** % de um candidato numa região, se ele estiver entre os dois primeiros dela. */
export function pctNaRegiao(r: Resumo | null | undefined, numero: string) {
  if (r?.lider?.numero === numero) return r.lider.pct;
  if (r?.segundo?.numero === numero) return r.segundo.pct;
  return null;
}

/** Primeiro nome de urna: "Flávio Bolsonaro" → "Flávio". */
export const primeiroNome = (nome: string) => {
  const p = nome.trim().split(/\s+/)[0] ?? '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
};
