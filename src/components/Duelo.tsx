import { type CSSProperties, useState } from 'react';
import type { Candidato, MapaDados, Resultado } from '../types';
import { Num } from './Num';
import { coresDuelo, corPartido, fmt, fmtPct, titulo, UF_NOMES } from '../util';

/** Os dois finalistas na ordem do número de urna (fica estável: ninguém troca de lado quando a liderança muda). */
export function finalistas(r: Resultado | null | undefined): [Candidato, Candidato] | null {
  if (!r || r.candidatos.length !== 2) return null;
  const [a, b] = [...r.candidatos].sort((x, y) => Number(x.numero) - Number(y.numero));
  return [a, b];
}

/** Cor de cada finalista por número (as do partido, ou uma reserva se as duas forem parecidas). */
export function coresFinalistas(par: [Candidato, Candidato] | null): Map<string, string> | null {
  if (!par) return null;
  const [ca, cb] = coresDuelo(par[0].partido, par[1].partido);
  return new Map([[par[0].numero, ca], [par[1].numero, cb]]);
}

interface Props {
  resultado: Resultado;
  cores: Map<string, string>;
  /** Onde: "Brasil", "Rio de Janeiro"… */
  local: string;
  /** Regiões vencidas por cada um (UFs no Brasil, municípios na UF), do mapa. */
  regioes?: { dados: MapaDados | null; rotulo: string } | null;
  carregando?: boolean;
}

/**
 * Placar do 2º turno: os dois finalistas frente a frente, a barra dos votos válidos com a marca dos
 * 50% (maioria absoluta) e quantas regiões cada um venceu no mapa.
 */
export function Duelo({ resultado: r, cores, local, regioes, carregando }: Props) {
  const par = finalistas(r);
  if (!par) return null;
  const vencidas = (numero: string) => (regioes?.dados
    ? Object.values(regioes.dados).filter((x) => x?.lider?.numero === numero).length
    : null);
  const pctApurado = r.secoes.pct;

  return (
    <section className={`duelo ${carregando ? 'atualizando' : ''}`} aria-label={`2º turno: ${r.cargo.nome}, ${local}`}>
      <div className="duelo-topo">
        {par.map((c, i) => (
          <Lado key={c.sq} c={c} cor={cores.get(c.numero)!} lado={i === 0 ? 'a' : 'b'} />
        ))}
        <div className="duelo-meta" aria-hidden="true">
          <span>50% dos válidos</span>
          <span>para vencer</span>
          <i />
        </div>
      </div>

      <div
        className="duelo-barra"
        role="img"
        aria-label={par.map((c) => `${titulo(c.nomeUrna)} ${fmtPct(c.pct)}`).join(', ')}
      >
        {par.map((c) => (
          <i key={c.sq} style={{ width: `${c.pct}%`, background: cores.get(c.numero) }} />
        ))}
        <span className="duelo-marca" />
      </div>

      <div className="duelo-rodape">
        {par.map((c, i) => {
          const n = vencidas(c.numero);
          return (
            <div key={c.sq} className={i === 0 ? 'lado-a' : 'lado-b'}>
              <strong><Num valor={c.pct} formatar={fmtPct} /> dos votos válidos</strong>
              <span className="muted">
                (<Num valor={c.votos} formatar={fmt} /> votos{n != null && regioes ? ` · venceu em ${n} ${regioes.rotulo}` : ''})
              </span>
            </div>
          );
        })}
        <div className="duelo-apurado muted">
          {local} · <Num valor={pctApurado} formatar={fmtPct} /> apurado
        </div>
      </div>
    </section>
  );
}

function Lado({ c, cor, lado }: { c: Candidato; cor: string; lado: 'a' | 'b' }) {
  const [semFoto, setSemFoto] = useState(false);
  const eleito = c.status === 'eleito' || c.matematicamente === 'eleito';
  return (
    <div className={`duelo-lado lado-${lado}`} style={{ '--cor': cor } as CSSProperties}>
      {semFoto ? (
        <span className="duelo-foto foto-vazia" style={{ background: cor }}>{c.nomeUrna.charAt(0)}</span>
      ) : (
        <img className="duelo-foto" src={c.foto} alt="" onError={() => setSemFoto(true)} />
      )}
      <div className="duelo-info">
        <span className="duelo-pct"><Num valor={c.pct} formatar={fmtPct} /></span>
        <span className="duelo-nome">
          {eleito && (
            <span className="duelo-check" title={c.status === 'eleito' ? 'Eleito' : 'Matematicamente eleito'} aria-label="Eleito">✓</span>
          )}
          {titulo(c.nomeUrna)}
        </span>
        <span className="duelo-partido">{c.partido} · {c.numero}</span>
      </div>
    </div>
  );
}

/**
 * Cargos estaduais no nível Brasil: uma linha por UF com 2º turno — os dois finalistas e a barra
 * dos votos válidos, a partir do resumo do mapa. Clique abre a UF.
 */
export function ListaDuelos({ ufs, dados, onSelect }: { ufs: string[]; dados: MapaDados | null; onSelect: (uf: string) => void }) {
  return (
    <ul className="lista-duelos">
      {ufs.map((uf) => {
        const r = dados?.[uf];
        const par = r?.lider && r.segundo
          ? [r.lider, r.segundo].sort((x, y) => Number(x.numero) - Number(y.numero))
          : null;
        // O líder fica com a cor do partido, como no mapa do Brasil; o rival muda se as cores se confundirem.
        const [cl, cs] = r?.lider && r.segundo ? coresDuelo(r.lider.partido, r.segundo.partido) : [];
        const cores = par ? par.map((c) => (c.numero === r!.lider!.numero ? cl : cs)) : null;
        return (
          <li key={uf}>
            <button onClick={() => onSelect(uf)}>
              <span className="lista-duelos-uf">
                {UF_NOMES[uf]}
                {r?.virou && <span className="selo" title="Quem lidera ficou em 2º no 1º turno">virou</span>}
              </span>
              {par && cores ? (
                <>
                  <span className="lista-duelos-nomes">
                    {par.map((c, i) => (
                      <span key={c.numero} className={c.numero === r!.lider!.numero ? 'lider' : ''}>
                        {i === 1 && ' × '}
                        {titulo(c.nome)} <span className="muted">({c.partido}) {fmtPct(c.pct)}</span>
                      </span>
                    ))}
                  </span>
                  <span className="duelo-barra duelo-barra-mini" aria-hidden="true">
                    {par.map((c, i) => <i key={c.numero} style={{ width: `${c.pct}%`, background: cores[i] }} />)}
                    <span className="duelo-marca" />
                  </span>
                  <span className="muted pequeno">{fmtPct(r!.pctApurado)} apurado</span>
                </>
              ) : (
                <span className="muted pequeno">
                  {dados ? 'Sem votos apurados' : 'Carregando…'}
                  {r?.lider && ` · ${titulo(r.lider.nome)}`}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Cor do líder de uma região no mapa do 2º turno: a do finalista (se conhecida) ou a do partido. */
export const corDoLider = (cores: Map<string, string> | null) =>
  (l: { numero: string; partido: string }) => cores?.get(l.numero) ?? corPartido(l.partido);
