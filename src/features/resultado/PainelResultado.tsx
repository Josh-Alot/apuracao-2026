import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Candidato, Resultado } from '../../lib/types';
import { EsqueletoPainel } from '../../ui/Carregando';
import { Num } from '../../ui/Num';
import { SeloSituacao } from '../../ui/SeloSituacao';
import { cliqueSimples } from '../../rota/Link';
import { useCores } from '../../lib/tema';
import { corPartido, fmt, fmtPct, semAcento, titulo } from '../../lib/util';
import { caminhoCandidato } from '../../rotas.mjs';

interface Props {
  resultado: Resultado | null;
  erro: string | null;
  carregando: boolean;
  /** Pré-preenche o filtro (ex.: candidato escolhido na busca global). */
  filtroInicial?: string;
  /** Abaixo do comparecimento (ex.: a caixa "Próximo plantão"). */
  lateral?: ReactNode;
  onAbrirCandidato: (c: Candidato) => void;
}

const PAGINA = 60;

/** Tabela de todos os candidatos (com filtro) e o comparecimento ao lado. */
export function PainelResultado({
  resultado: r, erro, carregando, filtroInicial, lateral, onAbrirCandidato,
}: Props) {
  const [filtro, setFiltro] = useState(filtroInicial ?? '');
  const [limite, setLimite] = useState(PAGINA);

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

  if (erro && !r) return <div className="grade-baixo"><section className="bloco"><p className="erro">{erro}</p></section></div>;
  if (!r) return <EsqueletoPainel />;

  return (
    <div className={`grade-baixo ${carregando ? 'atualizando' : ''}`} aria-busy={carregando}>
      <section className="bloco bloco-candidatos">
        <header className="bloco-cabecalho titulo-bloco-linha">
          <h2 className="titulo-bloco">Todos os candidatos</h2>
          <label className="campo-rotulado filtro">
            <span>Filtrar</span>
            <input
              type="search"
              placeholder="nome, nº ou partido"
              aria-label={`Filtrar ${r.candidatos.length} candidatos por nome, número ou partido`}
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
          </label>
        </header>
        {r.cargo.vagas > 1 && <p className="muted pequeno">{r.cargo.vagas} vagas</p>}

        <table className="tabela-candidatos">
          <thead>
            <tr><th className="col-num">Nº</th><th>Candidato</th><th>Partido</th><th className="col-votos">Votos</th><th className="col-pct">%</th></tr>
          </thead>
          <tbody>
            {lista.slice(0, limite).map((c) => (
              <LinhaCandidato key={c.sq} c={c} onAbrir={() => onAbrirCandidato(c)} />
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="muted">Nenhum candidato encontrado.</p>}
        {lista.length > limite && (
          <button className="mais" onClick={() => setLimite((l) => l + PAGINA * 2)}>
            Mostrar mais ({fmt(lista.length - limite)} restantes)
          </button>
        )}
      </section>

      <aside className="coluna-baixo">
        <Comparecimento r={r} />
        {lateral}
      </aside>
    </div>
  );
}

function Comparecimento({ r }: { r: Resultado }) {
  const item = (rotulo: string, valor: number, pct?: number) => (
    <div>
      <dt>{rotulo}</dt>
      <dd>
        <span className="valor-estatistica">{pct != null ? <Num valor={pct} formatar={fmtPct} /> : <Num valor={valor} formatar={fmt} />}</span>
        {pct != null && <small><Num valor={valor} formatar={fmt} /></small>}
      </dd>
    </div>
  );
  return (
    <section className="bloco bloco-comparecimento">
      <h2 className="titulo-bloco">Comparecimento</h2>
      <dl className="numeros">
        {item('Eleitorado', r.eleitorado.total)}
        {item('Compareceram', r.eleitorado.comparecimento, r.eleitorado.pctComparecimento)}
        {item('Abstenção', r.eleitorado.abstencao, r.eleitorado.pctAbstencao)}
        {item('Válidos', r.votos.validos, r.votos.pctValidos)}
        {item('Brancos', r.votos.brancos, r.votos.pctBrancos)}
        {item('Nulos', r.votos.nulos, r.votos.pctNulos)}
      </dl>
    </section>
  );
}

function LinhaCandidato({ c, onAbrir }: { c: Candidato; onAbrir: () => void }) {
  const tema = useCores();
  return (
    <tr className="clicavel" onClick={onAbrir}>
      <td className="col-num">{c.numero}</td>
      <td className="col-nome">
        {/* Link para a ficha (URL própria); ctrl/cmd/meio-clique abrem a ficha numa aba nova. */}
        <a
          className="cand-abrir"
          href={caminhoCandidato(c.sq, c.nomeUrna)}
          onClick={(e) => {
            e.stopPropagation(); // a linha inteira também abre a ficha
            if (!cliqueSimples(e)) return;
            e.preventDefault();
            onAbrir();
          }}
          title="Ver ficha do candidato"
        >
          {titulo(c.nomeUrna)}
        </a>
        <span className="selos"><SeloSituacao c={c} /></span>
        {c.vices && c.vices.length > 0 && (
          <span className="cand-vices muted">
            {c.vices.map((v) => `${v.tipo === 'v' ? 'Vice' : 'Suplente'}: ${titulo(v.nome)} (${v.partido})`).join(' · ')}
          </span>
        )}
      </td>
      <td className="col-partido">
        <i className="quadrado" style={{ background: tema.preench(corPartido(c.partido)) }} />
        {c.partido}<span className="so-celular"> · {c.numero}</span>
      </td>
      <td className="col-votos"><Num valor={c.votos} formatar={fmt} /></td>
      <td className="col-pct"><Num valor={c.pct} formatar={fmtPct} /></td>
    </tr>
  );
}
