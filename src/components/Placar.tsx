import { type CSSProperties, type ReactNode } from 'react';
import type { Candidato, MapaDados, Resultado, Resumo } from '../types';
import { Num } from './Num';
import { cliqueSimples } from './Link';
import { useCores } from '../tema';
import { fmt, fmtPct, titulo } from '../util';
import { caminhoCandidato } from '../rotas.mjs';

const pf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNumPct = (n: number) => pf.format(n);

interface Props {
  resultado: Resultado;
  /** Os dois da frente, na ordem de exibição (no 2º turno, pelo número de urna: ninguém troca de lado). */
  par: [Candidato, Candidato];
  /** Cor de cada um (a do partido ou a do duelo); o ajuste ao tema é feito aqui. */
  cores: [string, string];
  /** Versão menor (telas de UF, município e zona). */
  compacto?: boolean;
  /** Regiões vencidas por cada um (UFs no Brasil, municípios na UF), do mapa. */
  regioes?: { dados: MapaDados | null; rotulo: string } | null;
  /** Resumo do exterior (nível Brasil). */
  exterior?: Resumo | null;
  /** 2º turno ainda sem votos: o resultado do 1º turno na mesma região, para referência. */
  primeiroTurno?: Resultado | null;
  /** Marca dos 50% (maioria absoluta); fora no Senado, que elege os mais votados. */
  maioria: boolean;
  /** Linha de rótulo acima das colunas (o <h1> no nível Brasil). */
  rotulo?: ReactNode;
  carregando?: boolean;
  onAbrir: (c: Candidato) => void;
}

/** Texto do selo de situação no placar (bloco invertido), ou null. */
function situacao(c: Candidato) {
  if (c.status === 'eleito') return 'Eleito';
  if (c.status === 'segundo-turno') return 'Vai ao 2º turno';
  if (c.matematicamente === 'eleito') return 'Matematicamente eleito';
  if (c.matematicamente === 'segundo-turno') return '2º turno garantido';
  return null;
}

/**
 * Placar dos dois primeiros colocados (no 2º turno, os finalistas): nome, percentual dos válidos em letras
 * grandes, votos, regiões vencidas e a barra 1º | outros | 2º com a marca da maioria absoluta.
 */
export function Placar({
  resultado: r, par, cores, compacto, regioes, exterior, primeiroTurno, maioria, rotulo, carregando, onAbrir,
}: Props) {
  const tema = useCores();
  const [a, b] = par;
  const [corA, corB] = cores.map(tema.preench);
  const vazio = r.votos.validos === 0;
  const outros = r.candidatos.filter((c) => c.sq !== a.sq && c.sq !== b.sq);
  const pctOutros = Math.max(0, 100 - a.pct - b.pct);
  const vencidas = (numero: string) => (regioes?.dados
    ? Object.values(regioes.dados).filter((x) => x?.lider?.numero === numero).length
    : null);
  const noExterior = (numero: string) => {
    const c = [exterior?.lider, exterior?.segundo].find((x) => x?.numero === numero);
    return c ? fmtPct(c.pct) : '—';
  };
  const [lider, vice] = a.pct >= b.pct ? [a, b] : [b, a];

  return (
    <section
      className={`placar ${compacto ? 'placar-compacto' : ''} ${carregando ? 'atualizando' : ''}`}
      aria-label={`Placar: ${titulo(a.nomeUrna)} e ${titulo(b.nomeUrna)}`}
    >
      {rotulo}
      <div className="placar-colunas">
        {par.map((c, i) => {
          const sit = situacao(c);
          const n = vencidas(c.numero);
          const vc = c.vices?.find((v) => v.tipo === 'v');
          const c1 = primeiroTurno?.candidatos.find((x) => x.numero === c.numero);
          return (
            <div key={c.sq} className="placar-lado" style={{ '--cor': i === 0 ? corA : corB } as CSSProperties}>
              <div className="placar-nome-linha">
                <a
                  className="placar-nome"
                  href={caminhoCandidato(c.sq, c.nomeUrna)}
                  onClick={(e) => { if (cliqueSimples(e)) { e.preventDefault(); onAbrir(c); } }}
                  title="Ver ficha do candidato"
                >
                  {titulo(c.nomeUrna)}
                </a>
                {sit && <span className="placar-selo">{sit}</span>}
              </div>
              <p className="placar-sub">
                {c.partido} · {c.numero}
                {compacto
                  ? <> · <Num valor={c.votos} formatar={fmt} /> votos{n != null && regioes ? ` · ${fmt(n)} ${regioes.rotulo}` : ''}</>
                  : vc && ` · vice ${titulo(vc.nome)}`}
              </p>
              <div className="placar-numeros">
                <span className={`placar-pct ${vazio ? 'vazio' : ''}`}>
                  {vazio ? '––,––' : <Num valor={c.pct} formatar={fmtNumPct} />}
                  <span className="placar-sinal">%</span>
                </span>
                {!compacto && (
                  <dl className="placar-dados">
                    {vazio && c1 ? (
                      <>
                        <div><dt>1º turno</dt><dd>{fmtPct(c1.pct)}</dd></div>
                        <div><dt>Votos no 1º turno</dt><dd>{fmt(c1.votos)}</dd></div>
                      </>
                    ) : (
                      <>
                        <div><dt>Votos</dt><dd><Num valor={c.votos} formatar={fmt} /></dd></div>
                        {n != null && regioes && <div><dt>{regioes.rotulo}</dt><dd>{fmt(n)}</dd></div>}
                        {exterior !== undefined && <div><dt>Exterior</dt><dd>{noExterior(c.numero)}</dd></div>}
                      </>
                    )}
                  </dl>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={`placar-barra ${vazio ? 'vazia' : ''}`}
        role="img"
        aria-label={vazio
          ? 'Ainda sem votos apurados'
          : `${titulo(a.nomeUrna)} ${fmtPct(a.pct)}, outros ${fmtPct(pctOutros)}, ${titulo(b.nomeUrna)} ${fmtPct(b.pct)}`}
      >
        {!vazio && (
          <>
            <i style={{ width: `${a.pct}%`, background: corA }} />
            <i className="placar-outros" style={{ width: `${pctOutros}%` }} />
            <i style={{ width: `${b.pct}%`, background: corB }} />
          </>
        )}
        {maioria && <span className="placar-marca" />}
      </div>
      <div className="placar-legenda">
        {!vazio && (
          <span>
            Diferença: {pf.format(lider.pct - vice.pct)} pt · {fmt(lider.votos - vice.votos)} votos
          </span>
        )}
        {maioria && <span>Maioria absoluta 50%</span>}
        {outros.length > 0 && !vazio && <span>Outros {outros.length}: {fmtPct(pctOutros)}</span>}
      </div>
    </section>
  );
}

/** Linha de rótulo de uma tela: título à esquerda (o <h1> no nível Brasil) e um complemento à direita. */
export function LinhaRotulo({ children, direita }: { children: ReactNode; direita?: ReactNode }) {
  return (
    <div className="linha-rotulo">
      {children}
      {direita && <span className="linha-rotulo-direita">{direita}</span>}
    </div>
  );
}
