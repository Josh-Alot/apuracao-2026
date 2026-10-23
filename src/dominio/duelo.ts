import type { Candidato, Resultado } from '../lib/types';
import { coresDuelo, corPartido } from '../lib/util';

/** Os dois finalistas na ordem do número de urna (fica estável: ninguém troca de lado quando a liderança muda). */
export function finalistas(r: Resultado | null | undefined): [Candidato, Candidato] | null {
  if (!r || r.candidatos.length !== 2) return null;
  const [a, b] = [...r.candidatos].sort((x, y) => Number(x.numero) - Number(y.numero));
  return [a, b];
}

/** Cor de cada finalista por número (as do partido, ou uma reserva se as duas forem parecidas). */
export function coresFinalistas(par: [Candidato, Candidato] | null): Map<string, string> | null {
  if (!par) return null;
  const [ca, cb] = coresDuelo(par[0].partido, par[1].partido);
  return new Map([[par[0].numero, ca], [par[1].numero, cb]]);
}

/** Cor do líder de uma região no mapa do 2º turno: a do finalista (se conhecida) ou a do partido. */
export const corDoLider = (cores: Map<string, string> | null) =>
  (l: { numero: string; partido: string }) => cores?.get(l.numero) ?? corPartido(l.partido);
