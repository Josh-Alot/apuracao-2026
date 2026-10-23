import type { Candidato } from '../lib/types';

/**
 * Texto curto da situação do candidato (placar, ficha), ou null: a oficial do TSE primeiro, depois o
 * "matematicamente". `detalhe` acrescenta o tipo de eleição do proporcional ("Eleito por QP").
 */
export function textoSituacao(c: Candidato, { detalhe = false } = {}) {
  if (c.status === 'eleito') return detalhe && c.detalhe ? `Eleito ${c.detalhe}` : 'Eleito';
  if (c.status === 'segundo-turno') return 'Vai ao 2º turno';
  if (c.matematicamente === 'eleito') return 'Matematicamente eleito';
  if (c.matematicamente === 'segundo-turno') return '2º turno garantido';
  return null;
}
