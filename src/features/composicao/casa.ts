import { UF_NOMES } from '../../lib/util';

/** Casa legislativa do cargo na abrangência atual (null se o cargo não elege uma). */
export interface Casa { nacional: boolean; casaInteira: boolean; titulo: string; subtitulo?: string }

export function casaLegislativa(cargo: string, uf: string | undefined): Casa | null {
  const nomeUf = uf ? UF_NOMES[uf] : '';
  if (cargo === '5') {
    return {
      nacional: true, casaInteira: false, titulo: 'Senado Federal: eleitos em 2026',
      subtitulo: '2 das 3 cadeiras de cada UF (54 de 81); as outras 27 seguem até 2031',
    };
  }
  if (uf === 'zz') return null;
  if (cargo === '6') {
    return uf
      ? { nacional: false, casaInteira: false, titulo: `Câmara dos Deputados: ${nomeUf}`, subtitulo: 'Bancada do estado; a Câmara inteira aparece no nível Brasil' }
      : { nacional: true, casaInteira: true, titulo: 'Câmara dos Deputados' };
  }
  if (!uf) return null;
  if (cargo === '7') return { nacional: false, casaInteira: true, titulo: `Assembleia Legislativa: ${nomeUf}` };
  if (cargo === '8') return { nacional: false, casaInteira: true, titulo: 'Câmara Legislativa do Distrito Federal' };
  return null;
}
