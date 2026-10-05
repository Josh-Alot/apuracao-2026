import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { Candidato, Resultado } from '../types';
import { EsqueletoPainel } from './Carregando';
import { Num } from './Num';
import { SeloSituacao } from './SeloSituacao';
import { ProximaAtualizacao } from './ProximaAtualizacao';
import { ModalCandidato } from './ModalCandidato';
import type { AoVivo } from '../api';
import { corPartido, fmt, fmtPct, semAcento, titulo } from '../util';

interface Props {
  resultado: Resultado | null;
  erro: string | null;
  carregando: boolean;
  titulo: string;
  /** Pré-preenche o filtro (ex.: candidato escolhido na busca global). */
  filtroInicial?: string;
  /** Próxima consulta automática (ms) e intervalo do polling, para o aviso de atualização. */
  proxima: number | null;
  intervalo: number;
  aoVivo?: AoVivo | null;
  inicioAtualizacao?: string | null;
  encerrada?: boolean;
}

const PAGINA = 60;

export function PainelResultado({ resultado: r, erro, carregando, titulo: tituloLocal, filtroInicial, proxima, intervalo, aoVivo, inicioAtualizacao, encerrada }: Props) {
  const [filtro, setFiltro] = useState(filtroInicial ?? '');
  const [limite, setLimite] = useState(PAGINA);
  /** Candidato com a ficha aberta (sq). */
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => setFiltro(filtroInicial ?? ''), [filtroInicial]);
  useEffect(() => setLimite(PAGINA), [filtro, r?.cargo.cd]);

  const lista = useMemo(() => {
    if (!r) return [];
    const f = semAcento(filtro.trim());
    if (!f) return r.candidatos;
    if (/^\d+$/.test(f)) return r.candidatos.filter((c) => c.numero.startsWith(f));
    const tokens = f.split(/\s+/);
    return r.candidatos.filter((c) => {
      const chave = semAcento(`${c.nomeUrna} ${c.nome} ${c.partido}`);
      return tokens.every((t) => chave.includes(t));
    });
  }, [r, filtro]);

  if (erro && !r) return <section className="painel"><h2>{tituloLocal}</h2><p className="erro">{erro}</p></section>;
  if (!r) return <EsqueletoPainel titulo={tituloLocal} />;

  const posicao = new Map(r.candidatos.map((c, i) => [c.sq, i + 1]));
  const maxPct = Math.max(1, ...r.candidatos.slice(0, 1).map((c) => c.pct));
  const candAberto = aberto ? r.candidatos.find((c) => c.sq === aberto) : undefined;

  return (
    <section className={`painel ${carregando ? 'atualizando' : ''}`} aria-busy={carregando}>
      <header className="painel-topo">
        <div>
          <h2>{tituloLocal}</h2>
          <div className="muted">
            {r.cargo.nome}
            {r.cargo.vagas > 1 && ` · ${r.cargo.vagas} vagas`}
            {r.atualizado && ` · publicado pelo TSE em ${r.atualizado} (Brasília)`}
          </div>
          <div className={`pequeno muted ${carregando ? 'indicador-atualizando' : ''}`}>
            <ProximaAtualizacao proxima={proxima} intervalo={intervalo} carregando={carregando} aoVivo={aoVivo} inicio={inicioAtualizacao} encerrada={encerrada} />
          </div>
        </div>
        {r.totalizado && <span className="selo">Totalização final</span>}
      </header>

      <div className="progresso" title={`${fmt(r.secoes.totalizadas)} de ${fmt(r.secoes.total)} seções`}>
        <div className="progresso-barra"><i style={{ width: `${r.secoes.pct}%` }} /></div>
        <span><strong><Num valor={r.secoes.pct} formatar={fmtPct} /></strong> das seções apuradas</span>
      </div>

      <dl className="numeros">
        <div><dt>Eleitorado</dt><dd><Num valor={r.eleitorado.total} formatar={fmt} /></dd></div>
        <div><dt>Comparecimento</dt><dd><Num valor={r.eleitorado.comparecimento} formatar={fmt} /> <small><Num valor={r.eleitorado.pctComparecimento} formatar={fmtPct} /></small></dd></div>
        <div><dt>Abstenção</dt><dd><Num valor={r.eleitorado.abstencao} formatar={fmt} /> <small><Num valor={r.eleitorado.pctAbstencao} formatar={fmtPct} /></small></dd></div>
        <div><dt>Válidos</dt><dd><Num valor={r.votos.validos} formatar={fmt} /> <small><Num valor={r.votos.pctValidos} formatar={fmtPct} /></small></dd></div>
        <div><dt>Brancos</dt><dd><Num valor={r.votos.brancos} formatar={fmt} /> <small><Num valor={r.votos.pctBrancos} formatar={fmtPct} /></small></dd></div>
        <div><dt>Nulos</dt><dd><Num valor={r.votos.nulos} formatar={fmt} /> <small><Num valor={r.votos.pctNulos} formatar={fmtPct} /></small></dd></div>
      </dl>

      <div className="filtro">
        <input
          type="search"
          placeholder={`Filtrar ${r.candidatos.length} candidatos por nome, número ou partido`}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
      </div>

      <ol className="candidatos">
        {lista.slice(0, limite).map((c) => (
          <LinhaCandidato key={c.sq} c={c} pos={posicao.get(c.sq)!} maxPct={maxPct} onAbrir={() => setAberto(c.sq)} />
        ))}
      </ol>
      {lista.length === 0 && <p className="muted">Nenhum candidato encontrado.</p>}
      {lista.length > limite && (
        <button className="mais" onClick={() => setLimite((l) => l + PAGINA * 2)}>
          Mostrar mais ({fmt(lista.length - limite)} restantes)
        </button>
      )}
      {candAberto && (
        <ModalCandidato c={candAberto} pos={posicao.get(candAberto.sq)!} cargo={r.cargo.nome} onFechar={() => setAberto(null)} />
      )}
    </section>
  );
}

function LinhaCandidato({ c, pos, maxPct, onAbrir }: { c: Candidato; pos: number; maxPct: number; onAbrir: () => void }) {
  const [semFoto, setSemFoto] = useState(false);
  const cor = corPartido(c.partido);
  return (
    <li className="candidato clicavel" onClick={onAbrir}>
      <span className="pos">{pos}º</span>
      {semFoto ? (
        <span className="foto foto-vazia" style={{ background: cor }}>{c.nomeUrna.charAt(0)}</span>
      ) : (
        <img className="foto" src={c.foto} alt="" loading="lazy" onError={() => setSemFoto(true)} />
      )}
      <div className="cand-info">
        <div className="cand-nome">
          <button className="cand-abrir" onClick={(e) => { e.stopPropagation(); onAbrir(); }} title="Ver ficha do candidato">
            <strong>{titulo(c.nomeUrna)}</strong>
          </button>
          <span className="numero">{c.numero}</span>
          <span className="partido" style={{ '--cor': cor } as CSSProperties}>{c.partido}</span>
          <SeloSituacao c={c} />
        </div>
        {c.vices && c.vices.length > 0 && (
          <div className="muted pequeno">
            {c.vices.map((v) => `${v.tipo === 'v' ? 'Vice' : 'Suplente'}: ${titulo(v.nome)} (${v.partido})`).join(' · ')}
          </div>
        )}
        <div className="barra"><i style={{ width: `${(c.pct / maxPct) * 100}%`, background: cor }} /></div>
      </div>
      <div className="cand-votos">
        <strong><Num valor={c.pct} formatar={fmtPct} /></strong>
        <span className="muted"><Num valor={c.votos} formatar={fmt} /> votos</span>
      </div>
    </li>
  );
}
