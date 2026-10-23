import { type CSSProperties } from 'react';
import type { MapaDados } from '../../lib/types';
import { LinkTela } from '../../rota/Link';
import { useCores } from '../../lib/tema';
import { UF_NOMES, corPartido, fmtDecimal1, siglaUf } from '../../lib/util';

/**
 * Faixa rolável com o líder de cada UF (e do exterior), do mesmo /api/mapa do nível Brasil. Cada célula
 * leva a cor do líder no filete de cima e abre a UF.
 */
export function TickerUFs({ ufs, dados }: {
  ufs: string[]; dados: MapaDados | null;
}) {
  const tema = useCores();
  // Exterior por último, como "EXT".
  const ordem = [...ufs.filter((u) => u !== 'zz'), ...ufs.filter((u) => u === 'zz')];
  return (
    <nav className="ticker" aria-label="Líder em cada UF">
      <ul>
        {ordem.map((uf) => {
          const l = dados?.[uf]?.lider;
          const cor = l ? corPartido(l.partido) : null;
          return (
            <li key={uf}>
              <LinkTela
                para={{ uf }}
                style={{ '--cor': cor ? tema.preench(cor) : 'var(--borda)' } as CSSProperties}
                title={l ? `${UF_NOMES[uf]}: ${l.nome} (${l.partido}) lidera` : UF_NOMES[uf]}
              >
                <span className="ticker-uf">{siglaUf(uf)}</span>
                <span className="ticker-lider" style={cor ? { color: tema.texto(cor) } : undefined}>
                  {l ? `${l.nome.slice(0, 3).toUpperCase()} ${fmtDecimal1(l.pct)}` : '—'}
                </span>
              </LinkTela>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
