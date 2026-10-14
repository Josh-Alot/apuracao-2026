import type { Candidato, MapaDados, Resultado } from '../../lib/types';
import { Link } from '../../rota/Link';
import { useCores } from '../../lib/tema';
import { coresDuelo, corPartido, fmtPct, titulo, UF_NOMES } from '../../lib/util';

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

/**
 * Cargos estaduais no nível Brasil: uma linha por UF com 2º turno — os dois finalistas e a barra
 * dos votos válidos, a partir do resumo do mapa. Clique abre a UF.
 */
export function ListaDuelos({ ufs, dados, href, onSelect }: {
  ufs: string[]; dados: MapaDados | null; href: (uf: string) => string; onSelect: (uf: string) => void;
}) {
  const tema = useCores();
  return (
    <ul className="lista-duelos">
      {ufs.map((uf) => {
        const r = dados?.[uf];
        const par = r?.lider && r.segundo
          ? [r.lider, r.segundo].sort((x, y) => Number(x.numero) - Number(y.numero))
          : null;
        // O líder fica com a cor do partido, como no mapa do Brasil; o rival muda se as cores se confundirem.
        const [cl, cs] = r?.lider && r.segundo ? coresDuelo(r.lider.partido, r.segundo.partido) : [];
        const cores = par ? par.map((c) => tema.preench(c.numero === r!.lider!.numero ? cl! : cs!)) : null;
        return (
          <li key={uf}>
            <Link href={href(uf)} onNavegar={() => onSelect(uf)}>
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
                  <span className="placar-barra placar-barra-mini" aria-hidden="true">
                    {par.map((c, i) => <i key={c.numero} style={{ width: `${c.pct}%`, background: cores[i] }} />)}
                    <span className="placar-marca" />
                  </span>
                  <span className="muted pequeno">{fmtPct(r!.pctApurado)} apurado</span>
                </>
              ) : (
                <span className="muted pequeno">
                  {dados ? 'Sem votos apurados' : 'Carregando…'}
                  {r?.lider && ` · ${titulo(r.lider.nome)}`}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Cor do líder de uma região no mapa do 2º turno: a do finalista (se conhecida) ou a do partido. */
export const corDoLider = (cores: Map<string, string> | null) =>
  (l: { numero: string; partido: string }) => cores?.get(l.numero) ?? corPartido(l.partido);
