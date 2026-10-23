import type { MapaDados } from '../../lib/types';
import { LinkTela } from '../../rota/Link';
import { useCores } from '../../lib/tema';
import { coresDuelo, fmtPct, titulo, UF_NOMES } from '../../lib/util';

/**
 * Cargos estaduais no nível Brasil: uma linha por UF com 2º turno — os dois finalistas e a barra
 * dos votos válidos, a partir do resumo do mapa. Clique abre a UF.
 */
export function ListaDuelos({ ufs, dados }: {
  ufs: string[]; dados: MapaDados | null;
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
            <LinkTela para={{ uf }}>
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
            </LinkTela>
          </li>
        );
      })}
    </ul>
  );
}
