import { type CSSProperties, useMemo, useState } from 'react';
import type { Composicao } from '../types';
import { corPartido, fmt, fmtPct } from '../util';
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

const A_DEFINIR = '';

/** Composição de uma casa legislativa em hemiciclo: uma bolinha por cadeira, na cor do partido. */
export function Hemiciclo({ dados, erro, carregando, titulo, subtitulo, maioria }: Props) {
  const [destaque, setDestaque] = useState<string | null>(null);
  const vagas = dados?.vagas ?? 0;
  const { cadeiras, diametro } = useMemo(() => distribuir(vagas), [vagas]);

  // Partidos por número de cadeiras (o servidor já ordena); as vagas sem eleito ficam no fim, à direita.
  const ocupantes = useMemo(() => {
    const out: string[] = [];
    for (const p of dados?.partidos ?? []) for (let i = 0; i < p.cadeiras; i++) out.push(p.sigla);
    while (out.length < vagas) out.push(A_DEFINIR);
    return out;
  }, [dados, vagas]);

  const aDefinir = vagas - (dados?.atribuidas ?? 0);
  const raio = diametro * 0.42;
  const margem = raio + 0.02;
  const cor = (sigla: string) => (sigla === A_DEFINIR ? 'var(--sem-dado)' : corPartido(sigla));
  const resumoAcessivel = dados
    ? `${titulo}: ${dados.partidos.map((p) => `${p.sigla} ${p.cadeiras}`).join(', ')}${aDefinir > 0 ? `, ${aDefinir} a definir` : ''}.`
    : titulo;

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
          <svg
            viewBox={`${-1 - margem} ${-margem} ${2 + 2 * margem} ${1 + 2 * margem}`}
            role="img"
            aria-label={resumoAcessivel}
            onMouseLeave={() => setDestaque(null)}
          >
            {cadeiras.map((c, i) => {
              const sigla = ocupantes[i];
              const apagada = destaque != null && destaque !== sigla;
              return (
                <circle
                  key={i}
                  className="cadeira"
                  cx={c.x}
                  cy={1 - c.y}
                  r={raio}
                  fill={cor(sigla)}
                  opacity={apagada ? 0.18 : 1}
                  onMouseEnter={() => setDestaque(sigla)}
                >
                  <title>{sigla === A_DEFINIR ? 'A definir' : sigla}</title>
                </circle>
              );
            })}
            <text x="0" y={1 - 0.1} textAnchor="middle" className="hemiciclo-total">{fmt(vagas)}</text>
            <text x="0" y={1 - 0.01} textAnchor="middle" className="hemiciclo-rotulo">
              {maioria ? `cadeiras · maioria ${fmt(maioria)}` : 'cadeiras'}
            </text>
          </svg>

          <ul className="hemiciclo-legenda" onMouseLeave={() => setDestaque(null)}>
            {dados.partidos.map((p) => (
              <li
                key={p.sigla}
                className={destaque && destaque !== p.sigla ? 'apagado' : ''}
                onMouseEnter={() => setDestaque(p.sigla)}
              >
                <span className="bolinha" style={{ background: corPartido(p.sigla), marginRight: 0 }} />
                <span className="partido" style={{ '--cor': corPartido(p.sigla) } as CSSProperties}>{p.sigla}</span>
                <strong className="num">{p.cadeiras}</strong>
              </li>
            ))}
            {aDefinir > 0 && (
              <li className={destaque != null && destaque !== A_DEFINIR ? 'apagado' : ''} onMouseEnter={() => setDestaque(A_DEFINIR)}>
                <span className="bolinha" style={{ background: 'var(--sem-dado)', marginRight: 0 }} />
                <span className="muted" style={{ flex: 1 }}>A definir</span>
                <strong className="num">{aDefinir}</strong>
              </li>
            )}
          </ul>

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
