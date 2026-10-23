import type { Cargo, Config, Local } from '../lib/types';

/** Nome do cargo sem o turno: "Governador (2º turno)" → "Governador". */
export const cargoBase = (c: Cargo) => c.nome.replace(/ \(\d+º turno\)$/, '');

/** Nome do cargo como no <title> (e no <title> que o servidor injeta): "Governador", "Presidente 2º turno". */
export const nomeCargo = (c: Cargo) => (c.turno === 2 ? `${cargoBase(c)} 2º turno` : cargoBase(c));

/** Turnos presentes na config (1, ou 1 e 2 quando o TSE publica o 2º turno). */
export const turnosDe = (config: Config) => [...new Set(config.cargos.map((c) => c.turno))].sort();

/**
 * UF sem 2º turno para o cargo (a eleição dela se decidiu no 1º turno, ex.: governador de SP): a tela do Brasil
 * avisa e o mapa leva ao 1º turno dela.
 */
export const semSegundoTurno = (c: Cargo, uf: string | undefined): uf is string =>
  !!uf && uf !== 'zz' && !!c.primeiroTurno && !c.ufs.includes(uf);

/** Tela de outro cargo: mantém a UF quando o cargo existe nela, senão volta ao Brasil. */
export const localCargo = (c: Cargo, uf: string | undefined): Local => (uf && c.ufs.includes(uf) ? { uf } : {});

/** Destino da troca de turno: mantém o cargo (e a UF) quando ele existe no outro turno. */
export function destinoTurno(config: Config, cargo: Cargo, uf: string | undefined, turno: number): [Local, string] {
  const doTurno = config.cargos.filter((c) => c.turno === turno);
  const destino = doTurno.find((c) => c.cargo === cargo.cargo) ?? doTurno[0];
  return [localCargo(destino, uf), destino.id];
}
