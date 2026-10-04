import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { getJson, qs } from '../api';
import { Esq } from './Carregando';
import { Num } from './Num';
import { SeloSituacao } from './SeloSituacao';
import type { Cargo, ItemBusca } from '../types';
import { UF_NOMES, corPartido, fmt, fmtPct, titulo } from '../util';

interface Props {
  cargos: Cargo[];
  onEscolher: (item: ItemBusca) => void;
}

interface RespostaBusca {
  total: number;
  itens: ItemBusca[];
  /** Listas de candidatos (cargo × UF) que o servidor ainda não recebeu do TSE. */
  parcial: { listas: number; faltando: number } | null;
}

const REPETIR_PARCIAL_MS = 4_000;

export function BarraBusca({ cargos, onEscolher }: Props) {
  const [termo, setTermo] = useState('');
  const [cargo, setCargo] = useState('');
  const [uf, setUf] = useState('');
  const [res, setRes] = useState<RespostaBusca | null>(null);
  // Busca parcial (listas ainda chegando do TSE): repete sozinha até completar.
  const [tentativa, setTentativa] = useState(0);
  const ultimaBusca = useRef('');
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
    const chave = `${t}|${cargo}|${uf}`;
    const repeticao = chave === ultimaBusca.current; // mesma busca de novo: sem debounce
    ultimaBusca.current = chave;
    const id = setTimeout(async () => {
      setCarregando(true);
      try {
        const r = await getJson<RespostaBusca>(`/api/busca?${qs({ q: t, cargo, uf })}`, ctrl.signal);
        setRes(r);
        setErro(null);
        if (r.parcial) repetir = setTimeout(() => setTentativa((n) => n + 1), REPETIR_PARCIAL_MS);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErro(`Falha na busca: ${(e as Error).message}`);
      } finally {
        if (!ctrl.signal.aborted) setCarregando(false);
      }
    }, repeticao ? 0 : 300);
    let repetir: ReturnType<typeof setTimeout> | undefined;
    return () => {
      clearTimeout(id);
      clearTimeout(repetir);
      ctrl.abort();
    };
  }, [termo, cargo, uf, tentativa]);

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
          {res?.parcial && (
            <div className="muted pad pequeno busca-parcial">
              Busca incompleta: {res.parcial.faltando} de {res.parcial.listas} listas de candidatos ainda
              estão chegando do TSE. Os resultados se completam sozinhos em instantes…
            </div>
          )}
          {res && res.itens.length === 0 && (
            <div className="muted pad">
              {res.parcial ? 'Nenhum candidato encontrado por enquanto.' : 'Nenhum candidato encontrado.'}
            </div>
          )}
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
                        <span className="partido" style={{ '--cor': corPartido(i.partido) } as CSSProperties}>{i.partido}</span>
                        <SeloSituacao c={i} />
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
