import { type CSSProperties } from 'react';
import type { Candidato, MapaDados, Resumo } from '../../lib/types';
import { Link } from '../../rota/Link';
import { useCores } from '../../lib/tema';
import { UF_NOMES } from '../../lib/util';

const pf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'always' });

/** "+35,8" / "−4,1" (sinal de menos tipográfico). */
const comSinal = (n: number) => pf1.format(n).replace('-', '−');

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

/**
 * Diferença entre os dois primeiros colocados nacionais em cada UF: barra para a esquerda onde o 1º colocado
 * nacional vence, para a direita onde o 2º vence. Ordenada pela diferença com sinal.
 */
export function DiferencaUF({ a, b, cores, ufs, dados, href, onSelect }: {
  a: Candidato; b: Candidato; cores: [string, string]; ufs: string[]; dados: MapaDados | null;
  href: (uf: string) => string; onSelect: (uf: string) => void;
}) {
  const tema = useCores();
  const linhas = ufs.map((uf) => {
    const pa = pctNaRegiao(dados?.[uf], a.numero);
    const pb = pctNaRegiao(dados?.[uf], b.numero);
    return { uf, dif: pa != null && pb != null ? pa - pb : null };
  });
  linhas.sort((x, y) => (y.dif ?? -Infinity) - (x.dif ?? -Infinity));

  return (
    <section className="bloco diferenca-uf" aria-label="Diferença por UF">
      <header className="bloco-cabecalho">
        <h2 className="rotulo-secao">Diferença por UF</h2>
        <span className="rotulo-secao muted">← {primeiroNome(a.nomeUrna)} · {primeiroNome(b.nomeUrna)} →</span>
      </header>
      <ol>
        {linhas.map(({ uf, dif }) => {
          const cor = dif == null ? null : dif >= 0 ? cores[0] : cores[1];
          const largura = dif == null ? 0 : Math.min(100, (Math.abs(dif) / 50) * 100);
          const barra: CSSProperties | undefined = cor ? { width: `${largura}%`, background: tema.preench(cor) } : undefined;
          return (
            <li key={uf}>
              <Link href={href(uf)} onNavegar={() => onSelect(uf)} title={UF_NOMES[uf]}>
                <span className="muted">{uf === 'zz' ? 'EXT' : uf.toUpperCase()}</span>
                <span className="dif-metade dif-esquerda">{dif != null && dif >= 0 && <i style={barra} />}</span>
                <span className="dif-metade dif-direita">{dif != null && dif < 0 && <i style={barra} />}</span>
                <span className="dif-valor" style={cor ? { color: tema.texto(cor) } : undefined}>
                  {dif == null ? '—' : comSinal(dif)}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
