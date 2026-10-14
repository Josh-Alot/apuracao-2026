import type { Resumo, ResumoCandidato } from '../../lib/types';
import { useCores } from '../../lib/tema';
import { fmtPct, titulo } from '../../lib/util';
import { Link } from '../../rota/Link';

/** Exterior no mapa do Brasil: não tem malha, então vira um cartão ao lado da legenda. */
export function CartaoExterior({ dados, corLider, href, onAbrir }: {
  dados: Resumo; corLider: (l: ResumoCandidato) => string; href: string; onAbrir: () => void;
}) {
  const tema = useCores();
  const cands = [dados.lider, dados.segundo].filter((c): c is ResumoCandidato => !!c);
  return (
    <Link className="cartao-exterior" href={href} onNavegar={onAbrir} title="Ver votos por cidade no exterior">
      <strong>Exterior →</strong>
      <span className="cartao-exterior-cands">
        {cands.map((c) => (
          <span key={c.numero}>
            <i className="quadrado" style={{ background: tema.preench(corLider(c)) }} />
            {titulo(c.nome)}&nbsp;<b>{fmtPct(c.pct)}</b>
          </span>
        ))}
      </span>
      <span className="muted">{fmtPct(dados.pctApurado)} apurado</span>
    </Link>
  );
}
