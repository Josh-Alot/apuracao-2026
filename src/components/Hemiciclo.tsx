import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { Composicao, Eleito } from '../types';
import { corPartido, fmt, fmtPct, titulo as nomeProprio } from '../util';
import { Esq } from './Carregando';

interface Props {
  dados: Composicao | null;
  erro: string | null;
  carregando: boolean;
  titulo: string;
  subtitulo?: string;
  /** Maioria absoluta da casa (só quando a composição mostrada é a casa inteira). */
  maioria?: number;
}

interface Cadeira { x: number; y: number; angulo: number }

/**
 * Raio da fileira interna, em fração da externa (o "vão" do plenário, onde fica o total). Nas casas
 * pequenas as bolinhas são maiores e o vão precisa ser mais largo para o número não encostar nelas.
 */
const raioInterno = (n: number) => (n < 120 ? 0.46 : 0.36);
/** Diâmetro máximo da bolinha (casas com poucas cadeiras, como a bancada do Acre na Câmara). */
const DIAMETRO_MAX = 0.19;

/**
 * Posições das cadeiras num semicírculo de raio 1 (centro na origem, y para cima): fileiras
 * concêntricas, cada uma com cadeiras proporcionais ao comprimento, e o número de fileiras que deixa
 * as bolinhas maiores. Devolve as cadeiras da esquerda para a direita (por ângulo), para que cada
 * partido ocupe uma "fatia" do plenário, e o diâmetro disponível para cada bolinha.
 */
function distribuir(n: number): { cadeiras: Cadeira[]; diametro: number } {
  if (n <= 0) return { cadeiras: [], diametro: 0 };
  const RAIO_INTERNO = raioInterno(n);
  let melhor = { fileiras: 1, contagem: [n], raios: [1], diametro: 0 };
  for (let fileiras = 1; fileiras <= Math.max(1, Math.ceil(Math.sqrt(n))); fileiras++) {
    const raios = Array.from({ length: fileiras }, (_, i) =>
      fileiras === 1 ? 1 : RAIO_INTERNO + ((1 - RAIO_INTERNO) * i) / (fileiras - 1));
    const soma = raios.reduce((a, b) => a + b, 0);
    // Maiores restos: a soma das fileiras fecha exatamente em n.
    const exatas = raios.map((r) => (n * r) / soma);
    const contagem = exatas.map(Math.floor);
    const restos = exatas.map((x, i) => [x - contagem[i], i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < n - contagem.reduce((a, b) => a + b, 0); k++) contagem[restos[k][1]]++;
    if (contagem.some((c) => c < 1)) continue;
    const arco = Math.min(...raios.map((r, i) => (contagem[i] > 1 ? (Math.PI * r) / (contagem[i] - 1) : 2)));
    const radial = fileiras > 1 ? (1 - RAIO_INTERNO) / (fileiras - 1) : 2;
    const diametro = Math.min(arco, radial, DIAMETRO_MAX);
    if (diametro > melhor.diametro) melhor = { fileiras, contagem, raios, diametro };
  }
  const cadeiras: Cadeira[] = [];
  melhor.raios.forEach((r, i) => {
    const k = melhor.contagem[i];
    for (let j = 0; j < k; j++) {
      const angulo = k === 1 ? Math.PI / 2 : Math.PI - (Math.PI * j) / (k - 1);
      cadeiras.push({ x: r * Math.cos(angulo), y: r * Math.sin(angulo), angulo });
    }
  });
  // Esquerda → direita; no mesmo ângulo, de fora para dentro.
  cadeiras.sort((a, b) => b.angulo - a.angulo || Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));
  return { cadeiras, diametro: melhor.diametro };
}

/** O que está em foco: um partido (cabeçalho da lista) ou uma cadeira (bolinha ou linha da lista). */
type Foco = { partido: string } | { cadeira: number; daLista: boolean } | null;

const A_DEFINIR = '';

/** Composição de uma casa legislativa em hemiciclo: uma bolinha por cadeira, na cor do partido. */
export function Hemiciclo({ dados, erro, carregando, titulo, subtitulo, maioria }: Props) {
  const [foco, setFoco] = useState<Foco>(null);
  const lista = useRef<HTMLDivElement>(null);
  const vagas = dados?.vagas ?? 0;
  const { cadeiras, diametro } = useMemo(() => distribuir(vagas), [vagas]);

  // Donos das cadeiras na ordem do plenário (o servidor já ordena por partido e colocação); as vagas sem
  // eleito ficam no fim, à direita.
  const ocupantes = useMemo(() => {
    const out: (Eleito | null)[] = [...(dados?.eleitos ?? [])];
    while (out.length < vagas) out.push(null);
    return out;
  }, [dados, vagas]);
  const sigla = (i: number) => ocupantes[i]?.partido ?? A_DEFINIR;

  // Lista agrupada por partido, com o número da cadeira (posição no plenário, da esquerda para a direita).
  const grupos = useMemo(() => {
    const out: { sigla: string; cadeiras: number[] }[] = [];
    ocupantes.forEach((e, i) => {
      const s = e?.partido ?? A_DEFINIR;
      if (out.at(-1)?.sigla !== s) out.push({ sigla: s, cadeiras: [] });
      out.at(-1)!.cadeiras.push(i);
    });
    return out;
  }, [ocupantes]);

  const cadeiraFoco = foco && 'cadeira' in foco ? foco.cadeira : null;
  const partidoFoco = foco && 'partido' in foco ? foco.partido : cadeiraFoco != null ? sigla(cadeiraFoco) : null;

  // Cadeira apontada no hemiciclo: rola a lista (só ela, não a página) até o dono aparecer.
  useEffect(() => {
    if (cadeiraFoco == null || (foco && 'daLista' in foco && foco.daLista)) return;
    const caixa = lista.current;
    const li = caixa?.querySelector<HTMLElement>(`[data-cadeira="${cadeiraFoco}"]`);
    if (!caixa || !li) return;
    const cabecalho = li.closest('section')?.querySelector('h4')?.offsetHeight ?? 0;
    const topo = li.offsetTop - caixa.offsetTop;
    if (topo - cabecalho < caixa.scrollTop) caixa.scrollTop = topo - cabecalho;
    else if (topo + li.offsetHeight > caixa.scrollTop + caixa.clientHeight) caixa.scrollTop = topo + li.offsetHeight - caixa.clientHeight;
  }, [cadeiraFoco, foco]);

  const aDefinir = vagas - (dados?.atribuidas ?? 0);
  const raio = diametro * 0.42;
  const margem = raio + 0.02;
  const largura = 2 + 2 * margem;
  const altura = 1 + 2 * margem;
  const cor = (s: string) => (s === A_DEFINIR ? 'var(--sem-dado)' : corPartido(s));
  const resumoAcessivel = dados
    ? `${titulo}: ${dados.partidos.map((p) => `${p.sigla} ${p.cadeiras}`).join(', ')}${aDefinir > 0 ? `, ${aDefinir} a definir` : ''}.`
    : titulo;
  const noFoco = cadeiraFoco != null ? ocupantes[cadeiraFoco] : null;
  const posFoco = cadeiraFoco != null ? cadeiras[cadeiraFoco] : null;

  return (
    <section className={`hemiciclo ${carregando && dados ? 'atualizando' : ''}`} aria-busy={carregando}>
      <div className="hemiciclo-topo">
        <h3>{titulo}</h3>
        {subtitulo && <span className="muted pequeno">{subtitulo}</span>}
      </div>

      {erro && !dados && <p className="erro pequeno">Não foi possível carregar a composição: {erro}</p>}
      {!dados && !erro && <Esq w="100%" h="180px" />}

      {dados && vagas > 0 && (
        <>
          <div className="hemiciclo-plenario" onMouseLeave={() => setFoco(null)}>
            <svg viewBox={`${-1 - margem} ${-margem} ${largura} ${altura}`} role="img" aria-label={resumoAcessivel}>
              {cadeiras.map((c, i) => {
                const s = sigla(i);
                const realce = cadeiraFoco === i;
                const apagada = cadeiraFoco != null ? !realce : partidoFoco != null && partidoFoco !== s;
                return (
                  <circle
                    key={i}
                    className={`cadeira ${realce ? 'realce' : ''}`}
                    cx={c.x}
                    cy={1 - c.y}
                    r={realce ? raio * 1.25 : raio}
                    fill={cor(s)}
                    opacity={apagada ? (partidoFoco === s ? 0.7 : 0.15) : 1}
                    onMouseEnter={() => setFoco({ cadeira: i, daLista: false })}
                    onClick={() => setFoco(cadeiraFoco === i ? null : { cadeira: i, daLista: false })}
                  />
                );
              })}
              <text x="0" y={1 - 0.1} textAnchor="middle" className="hemiciclo-total">{fmt(vagas)}</text>
              <text x="0" y={1 - 0.01} textAnchor="middle" className="hemiciclo-rotulo">
                {maioria ? `cadeiras · maioria ${fmt(maioria)}` : 'cadeiras'}
              </text>
            </svg>

            {posFoco && cadeiraFoco != null && (
              <FichaCadeira
                e={noFoco}
                numero={cadeiraFoco + 1}
                projecao={dados.projecao}
                nacional={dados.abrangencia === 'br'}
                x={(posFoco.x + 1 + margem) / largura}
                y={(1 - posFoco.y + margem) / altura}
              />
            )}
          </div>

          <div className="hemiciclo-lista" ref={lista} onMouseLeave={() => setFoco(null)}>
            {grupos.map((g) => (
              <section key={g.sigla || 'a-definir'} className={partidoFoco != null && partidoFoco !== g.sigla ? 'apagado' : ''}>
                <h4 onMouseEnter={() => setFoco({ partido: g.sigla })}>
                  <span className="bolinha" style={{ background: cor(g.sigla), marginRight: 0 }} />
                  {g.sigla === A_DEFINIR
                    ? <span className="muted partido">A definir</span>
                    : <span className="partido" style={{ '--cor': corPartido(g.sigla) } as CSSProperties}>{g.sigla}</span>}
                  <strong className="num">{g.cadeiras.length}</strong>
                </h4>
                {g.sigla !== A_DEFINIR && (
                  <ol>
                    {g.cadeiras.map((i) => {
                      const e = ocupantes[i]!;
                      return (
                        <li
                          key={i}
                          data-cadeira={i}
                          tabIndex={0}
                          className={cadeiraFoco === i ? 'ativo' : ''}
                          onMouseEnter={() => setFoco({ cadeira: i, daLista: true })}
                          onFocus={() => setFoco({ cadeira: i, daLista: true })}
                          onBlur={() => setFoco(null)}
                        >
                          <span className="cadeira-num" title="Cadeira no plenário, da esquerda para a direita">{i + 1}</span>
                          <span className="cadeira-nome">{nomeProprio(e.nome)}</span>
                          {dados.abrangencia === 'br' && <span className="muted cadeira-uf">{e.uf.toUpperCase()}</span>}
                          <span className="num muted">{fmt(e.votos)}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            ))}
          </div>

          <p className="muted pequeno">
            {dados.atribuidas === 0
              ? 'Nenhuma cadeira definida ainda.'
              : dados.projecao
                ? `Projeção com ${fmtPct(dados.pctApurado)} das seções apuradas, antes da situação oficial do TSE: pode mudar até a totalização.`
                : 'Eleitos conforme a situação oficial do TSE.'}
            {dados.faltando > 0 && ` Faltam ${dados.faltando} UF(s) chegarem do TSE.`}
          </p>
        </>
      )}
    </section>
  );
}

/** Quem ocupa a cadeira em foco, sobre o hemiciclo (x/y em fração da área do desenho). */
function FichaCadeira({ e, numero, projecao, nacional, x, y }: {
  e: Eleito | null; numero: number; projecao: boolean; nacional: boolean; x: number; y: number;
}) {
  // Acima da bolinha; nas fileiras de cima, abaixo. Nas pontas, a ficha cresce para dentro.
  const abaixo = y < 0.4;
  const dx = x < 0.25 ? '-12%' : x > 0.75 ? '-88%' : '-50%';
  const dy = abaixo ? '14px' : 'calc(-100% - 14px)';
  return (
    <div className="tooltip ficha-cadeira" style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `translate(${dx}, ${dy})` }}>
      {e ? (
        <>
          <div className="ficha-cadeira-topo">
            <img src={e.foto} alt="" loading="lazy" onError={(ev) => { ev.currentTarget.style.visibility = 'hidden'; }} />
            <div>
              <strong>{nomeProprio(e.nome)}</strong>
              <span className="partido" style={{ '--cor': corPartido(e.partido) } as CSSProperties}>{e.partido}</span>
              {' '}<span className="muted">{e.numero}{nacional ? ` · ${e.uf.toUpperCase()}` : ''}</span>
            </div>
          </div>
          <div>{fmt(e.votos)} votos ({fmtPct(e.pct)})</div>
          <div className="muted">
            {e.colocacao}º mais votado{nacional ? ` em ${e.uf.toUpperCase()}` : ''}
            {e.detalhe ? ` · eleito ${e.detalhe}` : projecao ? ' · projeção' : ''}
          </div>
          <div className="muted pequeno">Cadeira {numero}</div>
        </>
      ) : (
        <>
          <strong>Cadeira {numero}</strong>
          <div className="muted">A definir</div>
        </>
      )}
    </div>
  );
}
