import { type CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { getJson, qs } from '../api';
import { Esq } from './Carregando';
import { Num } from './Num';
import { Link } from './Link';
import { SeloSituacao } from './SeloSituacao';
import type { Cargo, ItemBusca } from '../types';
import { PARTIDOS, UF_NOMES, corPartido, fmt, fmtPct, titulo } from '../util';

interface Props {
  cargos: Cargo[];
  /** Caminho da tela do item (cargo/UF), para o link; o clique simples chama `onEscolher`. */
  href: (item: ItemBusca) => string;
  onEscolher: (item: ItemBusca) => void;
}

interface RespostaBusca {
  total: number;
  itens: ItemBusca[];
  /** Listas de candidatos (cargo × UF) que o servidor ainda não recebeu do TSE. */
  parcial: { listas: number; faltando: number } | null;
  /** Siglas presentes no índice do servidor (para completar o filtro de partido). */
  partidos: string[];
}

const REPETIR_PARCIAL_MS = 4_000;
const POR_PAGINA = 50;
const PAGINA_PARTIDO = 200;

export function BarraBusca({ cargos, href, onEscolher }: Props) {
  const [termo, setTermo] = useState('');
  const [cargo, setCargo] = useState('');
  const [uf, setUf] = useState('');
  const [partido, setPartido] = useState('');
  const [limite, setLimite] = useState(POR_PAGINA);
  const [siglasServidor, setSiglasServidor] = useState<string[]>([]);
  const partidos = useMemo(
    () => [...new Set([...PARTIDOS, ...siglasServidor])].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [siglasServidor],
  );
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
    if (!partido && t.length < 2 && !/^\d+$/.test(t)) {
      setRes(null);
      return;
    }
    const ctrl = new AbortController();
    const chave = `${t}|${cargo}|${uf}|${partido}`;
    const repeticao = chave === ultimaBusca.current; // mesma busca de novo: sem debounce
    ultimaBusca.current = chave;
    const id = setTimeout(async () => {
      setCarregando(true);
      try {
        const r = await getJson<RespostaBusca>(`/api/busca?${qs({ q: t, cargo, uf, partido, limite: String(limite) })}`, ctrl.signal);
        setRes(r);
        if (r.partidos.some((p) => !PARTIDOS.includes(p))) setSiglasServidor(r.partidos);
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
  }, [termo, cargo, uf, partido, limite, tentativa]);

  // Filtros novos começam da primeira página.
  useEffect(() => setLimite(POR_PAGINA), [termo, cargo, uf, partido]);
  // Só o partido (sem termo): a lista vem agrupada por cargo, com um título a cada troca.
  const agrupar = !!partido && !termo.trim();

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
          placeholder={partido ? `Filtrar candidatos do ${partido}…` : 'Buscar candidato por nome ou número…'}
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
        <select value={partido} onChange={(e) => { setPartido(e.target.value); setAberto(true); }} aria-label="Filtrar por partido">
          <option value="">Todos os partidos</option>
          {partidos.map((p) => <option key={p} value={p}>{p}</option>)}
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
                {fmt(res.total)} {partido ? `candidato(s) do ${partido}` : 'resultado(s)'}
                {res.total > res.itens.length && `, mostrando ${fmt(res.itens.length)}`}
                {uf ? ` · votos em ${UF_NOMES[uf]}` : ''}
              </div>
              <ul>
                {res.itens.map((i, k) => (
                  <Fragment key={`${i.cargoId}-${i.uf}-${i.sq}`}>
                    {agrupar && i.cargoId !== res.itens[k - 1]?.cargoId && (
                      <li className="busca-grupo">{i.cargoNome}</li>
                    )}
                    <li>
                      <Link href={href(i)} onNavegar={() => { onEscolher(i); setAberto(false); }}>
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
                      </Link>
                    </li>
                  </Fragment>
                ))}
              </ul>
              {res.total > res.itens.length && (
                <button className="busca-mais" disabled={carregando}
                  onClick={() => setLimite((n) => n + (partido ? PAGINA_PARTIDO : POR_PAGINA))}>
                  Mostrar mais ({fmt(res.total - res.itens.length)} restantes)
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
