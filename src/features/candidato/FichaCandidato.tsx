import type { Resultado } from '../../lib/types';
import { ModalCandidato } from './ModalCandidato';

interface Props {
  resultado: Resultado | null;
  /** Candidato com a ficha aberta (sq): a ficha tem URL própria, então o estado fica no App. */
  sq?: string;
  /** Onde: "Brasil", "São Paulo"… */
  local: string;
  /** "15 UFs" vencidas pelo candidato, quando o mapa sabe. */
  vencidas?: (numero: string) => string | null;
  onFechar: () => void;
}

/** Ficha do candidato aberto, sobre a tela (é um <dialog> modal: a posição no DOM não importa). */
export function FichaCandidato({ resultado: r, sq, local, vencidas, onFechar }: Props) {
  const i = sq && r ? r.candidatos.findIndex((c) => c.sq === sq) : -1;
  if (!r || i < 0) return null;
  const c = r.candidatos[i];
  return (
    <ModalCandidato
      c={c}
      pos={i + 1}
      cargo={r.cargo.nome}
      local={local}
      vencidas={vencidas?.(c.numero) ?? null}
      onFechar={onFechar}
    />
  );
}
