import { type CSSProperties } from 'react';
import type { Candidato, MapaDados } from '../../lib/types';
import { LinkTela } from '../../rota/Link';
import { useCores } from '../../lib/tema';
import { UF_NOMES, fmtDiferenca1, siglaUf } from '../../lib/util';
import { pctNaRegiao, primeiroNome } from '../../dominio/placar';

/**
 * Diferença entre os dois primeiros colocados nacionais em cada UF: barra para a esquerda onde o 1º colocado
 * nacional vence, para a direita onde o 2º vence. Ordenada pela diferença com sinal.
 */
export function DiferencaUF({ a, b, cores, ufs, dados }: {
  a: Candidato; b: Candidato; cores: [string, string]; ufs: string[]; dados: MapaDados | null;
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
              <LinkTela para={{ uf }} title={UF_NOMES[uf]}>
                <span className="muted">{siglaUf(uf)}</span>
                <span className="dif-metade dif-esquerda">{dif != null && dif >= 0 && <i style={barra} />}</span>
                <span className="dif-metade dif-direita">{dif != null && dif < 0 && <i style={barra} />}</span>
                <span className="dif-valor" style={cor ? { color: tema.texto(cor) } : undefined}>
                  {dif == null ? '—' : fmtDiferenca1(dif)}
                </span>
              </LinkTela>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
