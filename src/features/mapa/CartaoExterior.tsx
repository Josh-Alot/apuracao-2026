import type { Resumo, ResumoCandidato } from '../../lib/types';
import { useCores } from '../../lib/tema';
import { fmtPct, titulo } from '../../lib/util';
import { LinkTela } from '../../rota/Link';

/** Exterior no mapa do Brasil: não tem malha, então vira um cartão ao lado da legenda. */
export function CartaoExterior({ dados, corLider }: {
  dados: Resumo; corLider: (l: ResumoCandidato) => string;
}) {
  const tema = useCores();
  const cands = [dados.lider, dados.segundo].filter((c): c is ResumoCandidato => !!c);
  return (
    <LinkTela className="cartao-exterior" para={{ uf: 'zz' }} title="Ver votos por cidade no exterior">
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
    </LinkTela>
  );
}
