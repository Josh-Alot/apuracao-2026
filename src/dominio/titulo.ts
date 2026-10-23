import type { Candidato, Cargo, Local, Municipio } from '../lib/types';
import { UF_NOMES, titulo } from '../lib/util';
import { tituloPagina } from '../../compartilhado/rotas.mjs';
import { nomeCargo } from './cargo';

/**
 * Título da aba (o servidor injeta o mesmo no HTML inicial). Na home (/) fica o título geral; com a ficha aberta, o do
 * candidato (null enquanto ele não aparece no resultado: o título anterior fica).
 */
export function tituloDaAba({ cargo, telaTemCargo, local, munAtual, ficha, candidato }: {
  cargo: Cargo;
  /** A URL nomeia o cargo (fora da home). */
  telaTemCargo: boolean;
  local: Local;
  munAtual: Municipio | undefined;
  /** sq da ficha aberta. */
  ficha: string | undefined;
  /** O candidato da ficha, se já está no resultado. */
  candidato: Candidato | undefined;
}): string | null {
  if (ficha) return candidato ? tituloPagina({ candidato: titulo(candidato.nomeUrna), partido: candidato.partido }) : null;
  if (!telaTemCargo) return tituloPagina({});
  const { uf } = local;
  return tituloPagina({
    cargoNome: nomeCargo(cargo), uf, ufNome: uf && UF_NOMES[uf],
    munNome: munAtual && titulo(munAtual.nome), zona: munAtual ? local.zona : undefined,
  });
}

/** Nome da região da tela: "Zona 1 · São Paulo", "São Paulo (SP)", "São Paulo", "Brasil". */
export function nomeDaRegiao(local: Local, munAtual: Municipio | undefined) {
  if (local.zona) return `Zona ${Number(local.zona)} · ${titulo(munAtual?.nome ?? '')}`;
  if (munAtual) return `${titulo(munAtual.nome)} (${local.uf!.toUpperCase()})`;
  return local.uf ? UF_NOMES[local.uf] : 'Brasil';
}
