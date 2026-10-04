import { useMemo, useState } from 'react';
import type { MapaDados } from '../types';
import { Esq } from './Carregando';
import { corPartido, fmtPct, semAcento, titulo as capitalizar } from '../util';

interface Props {
  titulo: string;
  itens: { chave: string; nome: string }[];
  dados: MapaDados | null;
  /** Dados sendo (re)consultados no TSE. */
  carregando?: boolean;
  selecionado?: string;
  onSelect: (chave: string) => void;
}

/** Lista clicável de regiões sem malha geográfica (zonas eleitorais, cidades no exterior). */
export function ListaRegioes({ titulo, itens, dados, carregando, selecionado, onSelect }: Props) {
  const [filtro, setFiltro] = useState('');
  const visiveis = useMemo(() => {
    const f = semAcento(filtro.trim());
    return f ? itens.filter((i) => semAcento(i.nome).includes(f)) : itens;
  }, [itens, filtro]);

  return (
    <div className={`lista-regioes ${carregando && dados ? 'atualizando' : ''}`} aria-busy={carregando}>
      <div className="lista-topo">
        <h3>{titulo}</h3>
        {itens.length > 12 && (
          <input type="search" placeholder="Filtrar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        )}
      </div>
      <ul>
        {visiveis.map((i) => {
          const r = dados?.[i.chave];
          return (
            <li key={i.chave}>
              <button className={i.chave === selecionado ? 'ativo' : ''} onClick={() => onSelect(i.chave)}>
                <span className="bolinha" style={{ background: r?.lider ? corPartido(r.lider.partido) : 'var(--sem-dado)' }} />
                <span className="regiao-nome">{i.nome}</span>
                <span className="muted pequeno num">
                  {!dados ? <Esq w="75%" h="0.8rem" /> : r?.lider ? `${capitalizar(r.lider.nome)} (${r.lider.partido}) ${fmtPct(r.lider.pct)}` : '—'}
                  {r && ` · ${fmtPct(r.pctApurado)} apur.`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
