import { type CSSProperties } from 'react';
import type { MapaDados } from '../../lib/types';
import { Link } from '../../rota/Link';
import { useCores } from '../../lib/tema';
import { UF_NOMES, corPartido } from '../../lib/util';

const pf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Faixa rolável com o líder de cada UF (e do exterior), do mesmo /api/mapa do nível Brasil. Cada célula
 * leva a cor do líder no filete de cima e abre a UF.
 */
export function TickerUFs({ ufs, dados, href, onSelect }: {
  ufs: string[]; dados: MapaDados | null; href: (uf: string) => string; onSelect: (uf: string) => void;
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
              <Link
                href={href(uf)}
                onNavegar={() => onSelect(uf)}
                style={{ '--cor': cor ? tema.preench(cor) : 'var(--borda)' } as CSSProperties}
                title={l ? `${UF_NOMES[uf]}: ${l.nome} (${l.partido}) lidera` : UF_NOMES[uf]}
              >
                <span className="ticker-uf">{uf === 'zz' ? 'EXT' : uf.toUpperCase()}</span>
                <span className="ticker-lider" style={cor ? { color: tema.texto(cor) } : undefined}>
                  {l ? `${l.nome.slice(0, 3).toUpperCase()} ${pf1.format(l.pct)}` : '—'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
