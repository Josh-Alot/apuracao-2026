import { useEffect, useRef, useState } from 'react';
import { getJson, qs } from '../api';
import { Esq } from './Carregando';
import { Num } from './Num';
import type { Cargo, ItemBusca } from '../types';
import { UF_NOMES, corPartido, fmt, fmtPct, titulo } from '../util';

interface Props {
  cargos: Cargo[];
  onEscolher: (item: ItemBusca) => void;
}

export function BarraBusca({ cargos, onEscolher }: Props) {
  const [termo, setTermo] = useState('');
  const [cargo, setCargo] = useState('');
  const [uf, setUf] = useState('');
  const [res, setRes] = useState<{ total: number; itens: ItemBusca[] } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = termo.trim();
    if (t.length < 2 && !/^\d+$/.test(t)) {
      setRes(null);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setCarregando(true);
      try {
        setRes(await getJson(`/api/busca?${qs({ q: t, cargo, uf })}`, ctrl.signal));
        setErro(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErro((e as Error).message);
      } finally {
        setCarregando(false);
      }
    }, 300);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [termo, cargo, uf]);

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, []);

  return (
    <div className="busca" ref={caixa}>
      <div className="busca-campos">
        <input
          type="search"
          placeholder="Buscar candidato por nome ou número…"
          value={termo}
          onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAberto(false);
            if (e.key === 'Enter' && res?.itens[0]) { onEscolher(res.itens[0]); setAberto(false); }
          }}
          aria-label="Buscar candidato"
        />
        <select value={cargo} onChange={(e) => setCargo(e.target.value)} aria-label="Filtrar por cargo">
          <option value="">Todos os cargos</option>
          {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select value={uf} onChange={(e) => setUf(e.target.value)} aria-label="Filtrar por UF">
          <option value="">Todas as UFs</option>
          {Object.entries(UF_NOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {aberto && (res || carregando || erro) && (
        <div className={`busca-resultados ${carregando && res ? 'atualizando' : ''}`} aria-busy={carregando}>
          {carregando && !res && (
            <>
              <div className="muted pad pequeno">Buscando votos no TSE… a primeira busca indexa todos os cargos e pode levar alguns segundos.</div>
              <ul>
                {Array.from({ length: 4 }, (_, k) => (
                  <li key={k}>
                    <div className="busca-esq">
                      <Esq w="34px" h="34px" redondo />
                      <span className="busca-info"><Esq w={`${55 - k * 8}%`} /><Esq w="40%" h="0.75rem" className="esq-espaco" /></span>
                      <span className="cand-votos"><Esq w="4.5rem" /><Esq w="3rem" h="0.75rem" className="esq-espaco" /></span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {erro && <div className="erro pad">{erro}</div>}
          {res && res.itens.length === 0 && <div className="muted pad">Nenhum candidato encontrado.</div>}
          {res && res.itens.length > 0 && (
            <>
              <div className="muted pad pequeno">
                {fmt(res.total)} resultado(s){res.total > res.itens.length && `, mostrando ${res.itens.length}`}
                {uf ? ` · votos em ${UF_NOMES[uf]}` : ''}
              </div>
              <ul>
                {res.itens.map((i) => (
                  <li key={`${i.cargoId}-${i.uf}-${i.sq}`}>
                    <button onClick={() => { onEscolher(i); setAberto(false); }}>
                      <img className="foto pequena" src={i.foto} alt="" loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                      <span className="busca-info">
                        <strong>{titulo(i.nomeUrna)}</strong> <span className="numero">{i.numero}</span>{' '}
                        <span className="partido" style={{ color: corPartido(i.partido), borderColor: corPartido(i.partido) }}>{i.partido}</span>
                        <span className="muted pequeno">
                          {i.cargoNome} · {i.uf === 'br' ? 'Brasil' : UF_NOMES[i.uf]} · {fmtPct(i.pctApurado)} apurado
                        </span>
                      </span>
                      <span className="cand-votos">
                        <strong><Num valor={i.votos} formatar={fmt} /></strong>
                        <span className="muted"><Num valor={i.pct} formatar={fmtPct} /></span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
