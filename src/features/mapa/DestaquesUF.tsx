import { type CSSProperties } from 'react';
import type { Candidato, MapaDados } from '../../lib/types';
import { Link } from '../../rota/Link';
import { pctNaRegiao, primeiroNome } from './DiferencaUF';
import { useCores } from '../../lib/tema';
import { corPartido, fmt, fmtPct, titulo } from '../../lib/util';

const pf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Eleitorado mínimo para entrar nas disputas apertadas (municípios pequenos empatam por poucos votos). */
const MIN_ELEITORES_APERTADA = 75_000;

interface Props {
  dados: MapaDados | null;
  /** Os dois primeiros da UF (colunas de % dos maiores eleitorados); null sem placar. */
  par: [Candidato, Candidato] | null;
  nome: (cd: string) => string;
  href: (cd: string) => string;
  onSelect: (cd: string) => void;
  /** Total de municípios e como abrir o índice completo. */
  total: number;
  onVerTodos: () => void;
}

/** Coluna ao lado do mapa da UF: maiores eleitorados e disputas mais apertadas, do mesmo /api/mapa. */
export function DestaquesUF({ dados, par, nome, href, onSelect, total, onVerTodos }: Props) {
  const tema = useCores();
  const regioes = Object.entries(dados ?? {}).filter(([, r]) => r?.eleitorado != null);
  if (!regioes.length) return null;

  const maiores = [...regioes].sort(([, x], [, y]) => y!.eleitorado! - x!.eleitorado!).slice(0, 12);
  const apertadas = regioes
    .filter(([, r]) => r!.eleitorado! > MIN_ELEITORES_APERTADA && r!.lider && r!.segundo)
    .sort(([, x], [, y]) => (x!.lider!.pct - x!.segundo!.pct) - (y!.lider!.pct - y!.segundo!.pct))
    .slice(0, 6);

  return (
    <div className="destaques-uf">
      <section className="bloco maiores-eleitorados">
        <header className="bloco-cabecalho">
          <h2 className="rotulo-secao">Maiores eleitorados</h2>
          {par && (
            <span className="maiores-colunas rotulo-secao muted" aria-hidden="true">
              <span>{primeiroNome(par[0].nomeUrna)}</span><span>{primeiroNome(par[1].nomeUrna)}</span>
            </span>
          )}
        </header>
        <ol>
          {maiores.map(([cd, r]) => {
            const cor = r!.lider ? tema.preench(corPartido(r!.lider.partido)) : 'var(--borda)';
            const pa = par ? pctNaRegiao(r, par[0].numero) : null;
            const pb = par ? pctNaRegiao(r, par[1].numero) : null;
            return (
              <li key={cd}>
                <Link href={href(cd)} onNavegar={() => onSelect(cd)} style={{ '--cor': cor } as CSSProperties}>
                  <span className="maiores-nome">
                    <strong>{nome(cd)}</strong>
                    <span className="muted">{fmt(r!.eleitorado!)} eleitores</span>
                  </span>
                  {par ? (
                    <>
                      <span className={pa != null && (pb == null || pa >= pb) ? 'vence' : 'muted'}>{pa != null ? fmtPct(pa) : '—'}</span>
                      <span className={pb != null && (pa == null || pb > pa) ? 'vence' : 'muted'}>{pb != null ? fmtPct(pb) : '—'}</span>
                    </>
                  ) : r!.lider && (
                    <span className="vence">{titulo(r!.lider.nome)} {fmtPct(r!.lider.pct)}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
        <button type="button" className="botao-texto" onClick={onVerTodos}>Ver os {fmt(total)} municípios</button>
      </section>

      {apertadas.length > 0 && (
        <section className="bloco disputas-apertadas">
          <header className="bloco-cabecalho">
            <h2 className="rotulo-secao">Disputas mais apertadas</h2>
            <span className="rotulo-secao muted">acima de 75 mil eleitores</span>
          </header>
          <ul>
            {apertadas.map(([cd, r]) => (
              <li key={cd}>
                <Link href={href(cd)} onNavegar={() => onSelect(cd)}>
                  <strong>{nome(cd)}</strong>
                  <span style={{ color: tema.texto(corPartido(r!.lider!.partido)) }}>
                    {primeiroNome(r!.lider!.nome)} +{pf2.format(r!.lider!.pct - r!.segundo!.pct)} pt
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
