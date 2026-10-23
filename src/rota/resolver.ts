import type { Cargo, Config, Local } from '../lib/types';
import { cargoPorSlug } from '../../compartilhado/rotas.mjs';
import type { Tela } from './rota';

/**
 * Cargo e região de uma tela: o cargo pelo id (link antigo) ou pelo slug, senão o primeiro da config; a UF só se o
 * cargo existe nela (ex.: Dep. Distrital fora do DF volta ao Brasil); a zona só com o município.
 */
export function resolverTela(config: Config, tela: Tela): { cargo: Cargo | undefined; uf: string | undefined; local: Local } {
  const cargo = tela.cargo
    ? config.cargos.find((c) => c.id === tela.cargo) ?? cargoPorSlug(config.cargos, tela.cargo) ?? config.cargos[0]
    : config.cargos[0];
  const uf = tela.uf && cargo && !cargo.ufs.includes(tela.uf) ? undefined : tela.uf;
  const local: Local = uf ? { uf, mun: tela.mun, zona: tela.mun ? tela.zona : undefined } : {};
  return { cargo, uf, local };
}
