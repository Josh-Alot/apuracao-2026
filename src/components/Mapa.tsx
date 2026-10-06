import { useEffect, useMemo, useRef, useState } from 'react';
import { geoPath, geoTransform } from 'd3-geo';
import type { Feature, FeatureCollection } from 'geojson';
import type { MapaDados, ModoMapa, Resumo, ResumoCandidato } from '../types';
import { EsqueletoMapa } from './Carregando';
import { corApuracao, corPartido, fmt, fmtPct, titulo } from '../util';

const W = 1000;
const H = 820;
const MARGEM = 12;
/** Aproximação máxima em relação ao mapa inteiro (municípios pequenos de SP/MG precisam de muito). */
const ZOOM_MAX = 60;
/** Movimento (px) a partir do qual um clique vira arraste e não seleciona a região. */
const LIMIAR_ARRASTE = 5;

interface Vista { x: number; y: number; w: number; h: number }

interface Props {
  geo: FeatureCollection | null;
  /** Converte uma feature da malha na chave usada em `dados` (UF ou código TSE do município). */
  chave: (f: Feature) => string | undefined;
  nome: (chave: string) => string;
  dados: MapaDados | null;
  modo: ModoMapa;
  selecionado?: string;
  /** Chave da região a enquadrar (zoom). */
  focar?: string;
  rotuloRegiao: string; // "estados", "municípios"…
  /** Legenda por partido em vez de por candidato (cargos estaduais vistos no mapa do Brasil). */
  legendaPorPartido?: boolean;
  /**
   * 2º turno: cor sólida onde a apuração terminou ("venceu"), clara onde ainda não ("liderando") e
   * hachurada onde quem lidera ficou atrás do rival no 1º turno ("virou").
   */
  segundoTurno?: boolean;
  /** Cor do líder (no 2º turno, a do finalista); padrão: a do partido. */
  corLider?: (l: ResumoCandidato) => string;
  /** Sigla de cada região escrita no mapa (UFs no mapa do Brasil). */
  rotulos?: boolean;
  onSelect: (chave: string) => void;
}

/** Estado de uma região no mapa do 2º turno. */
const estado2t = (r: Resumo) => (r.virou ? 'virou' : r.pctApurado >= 100 ? 'venceu' : 'liderando');
const ROTULO_ESTADO = { liderando: 'Liderando', venceu: 'Venceu', virou: 'Virou' } as const;

/** Percorre todas as coordenadas de uma geometria. */
function cadaPonto(g: Feature['geometry'], fn: (x: number, y: number) => void) {
  const anda = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') fn((c as number[])[0], (c as number[])[1]);
    else (c as unknown[]).forEach(anda);
  };
  if (g && 'coordinates' in g) anda(g.coordinates);
}

/**
 * Projeção plana (equiretangular com correção cos(lat)) ajustada ao viewBox.
 * É plana de propósito: as malhas do IBGE não seguem a orientação de anéis que
 * as projeções esféricas do d3 exigem, e para um país/estado a distorção é irrelevante.
 */
function projetar(fc: FeatureCollection) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of fc.features) {
    cadaPonto(f.geometry, (x, y) => {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    });
  }
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const s = Math.min((W - 2 * MARGEM) / ((x1 - x0) * k), (H - 2 * MARGEM) / (y1 - y0));
  const ox = (W - (x1 - x0) * k * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  return geoPath(
    geoTransform({
      point(x, y) {
        this.stream.point(ox + (x - x0) * k * s, oy + (y1 - y) * s);
      },
    }),
  );
}

export function Mapa({
  geo, chave, nome, dados, modo, selecionado, focar, rotuloRegiao, legendaPorPartido, segundoTurno, corLider, rotulos, onSelect,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ k: string; x: number; y: number } | null>(null);

  const regioes = useMemo(() => {
    if (!geo) return [];
    const path = projetar(geo);
    return geo.features
      .map((f) => ({ k: chave(f), d: path(f) ?? '', b: path.bounds(f), c: path.centroid(f) }))
      .filter((r): r is { k: string; d: string; b: [[number, number], [number, number]]; c: [number, number] } => !!r.k);
  }, [geo, chave]);

  // Enquadramento padrão: o mapa inteiro, ou a região em foco.
  const base = useMemo<Vista>(() => {
    const alvo = focar && regioes.find((r) => r.k === focar);
    if (!alvo) return { x: 0, y: 0, w: W, h: H };
    const [[a, b], [c, d]] = alvo.b;
    const lado = Math.max(c - a, (d - b) * (W / H), 60) * 1.8;
    const alt = lado * (H / W);
    return { x: (a + c) / 2 - lado / 2, y: (b + d) / 2 - alt / 2, w: lado, h: alt };
  }, [focar, regioes]);

  // Zoom/arraste do leitor; volta ao enquadramento padrão quando ele muda.
  const [zoom, setZoom] = useState<Vista | null>(null);
  useEffect(() => setZoom(null), [base.x, base.y, base.w]);
  const vista = zoom ?? base;
  const vistaRef = useRef(vista);
  vistaRef.current = vista;

  const svgRef = useRef<SVGSVGElement>(null);
  /** Ponto da tela → coordenadas do viewBox. */
  const paraMapa = (cx: number, cy: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  /** Mantém a vista dentro dos limites de zoom e sem deixar o mapa sair da tela. */
  const limitar = (v: Vista): Vista => {
    const w = Math.min(W, Math.max(W / ZOOM_MAX, v.w));
    const h = w * (H / W);
    const cx = Math.min(W, Math.max(0, v.x + v.w / 2));
    const cy = Math.min(H, Math.max(0, v.y + v.h / 2));
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  };
  /** Aproxima (fator > 1) ou afasta mantendo fixo o ponto `p` do mapa (o centro, se omitido). */
  const aplicarZoom = (fator: number, p?: { x: number; y: number } | null) => {
    const v = vistaRef.current;
    const c = p ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
    const w = Math.min(W, Math.max(W / ZOOM_MAX, v.w / fator));
    const f = v.w / w;
    setZoom(limitar({ x: c.x - (c.x - v.x) / f, y: c.y - (c.y - v.y) / f, w, h: w * (H / W) }));
  };

  // Roda do mouse / pinça do touchpad. Listener nativo porque o do React é passivo (não dá para
  // impedir a rolagem da página).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      aplicarZoom(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002)), paraMapa(e.clientX, e.clientY));
    };
    svg.addEventListener('wheel', roda, { passive: false });
    return () => svg.removeEventListener('wheel', roda);
  });

  // Arraste (mouse ou 1 dedo) e pinça (2 dedos) com Pointer Events.
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<{ inicio: { x: number; y: number }; arrastou: boolean; dist?: number } | null>(null);
  const cliqueSuprimido = useRef(false);

  const aoApertar = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cliqueSuprimido.current = false;
    if (ponteiros.current.size === 1) gesto.current = { inicio: { x: e.clientX, y: e.clientY }, arrastou: false };
    else gesto.current = { inicio: { x: e.clientX, y: e.clientY }, arrastou: true };
  };
  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const antes = ponteiros.current.get(e.pointerId);
    const g = gesto.current;
    if (!antes || !g) return;
    const agora = { x: e.clientX, y: e.clientY };

    if (ponteiros.current.size >= 2) {
      const [a, b] = [...ponteiros.current.entries()].map(([id, p]) => (id === e.pointerId ? agora : p));
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist) aplicarZoom(dist / g.dist, paraMapa((a.x + b.x) / 2, (a.y + b.y) / 2));
      g.dist = dist;
    } else {
      if (!g.arrastou && Math.hypot(agora.x - g.inicio.x, agora.y - g.inicio.y) < LIMIAR_ARRASTE) return;
      if (!g.arrastou) {
        g.arrastou = true;
        // Só captura depois de virar arraste: capturar antes desviaria o clique do <path>.
        e.currentTarget.setPointerCapture(e.pointerId);
        setHover(null);
      }
      const p0 = paraMapa(antes.x, antes.y);
      const p1 = paraMapa(agora.x, agora.y);
      const v = vistaRef.current;
      if (p0 && p1) setZoom(limitar({ ...v, x: v.x - (p1.x - p0.x), y: v.y - (p1.y - p0.y) }));
    }
    ponteiros.current.set(e.pointerId, agora);
  };
  const aoSoltar = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!ponteiros.current.delete(e.pointerId)) return;
    if (gesto.current?.arrastou) cliqueSuprimido.current = true;
    if (ponteiros.current.size === 0) gesto.current = null;
    else if (gesto.current) gesto.current.dist = undefined;
  };

  const ampliado = vista.w < base.w * 0.999 || vista.x !== base.x || vista.y !== base.y;
  const noMaximo = vista.w <= W / ZOOM_MAX + 1e-6;
  const noMinimo = vista.w >= W - 1e-6;

  const corDe = corLider ?? ((l: ResumoCandidato) => corPartido(l.partido));
  const doisTurnos = segundoTurno && modo === 'lider';
  // Hachuras do "virou": uma por cor, com listras de largura fixa na tela (acompanham o zoom).
  const hachuras = useMemo(() => {
    if (!doisTurnos || !dados) return [];
    return [...new Set(Object.values(dados).filter((r) => r?.virou && r.lider).map((r) => corDe(r!.lider!)))];
  }, [doisTurnos, dados, corDe]);
  const cor = (r: Resumo | null | undefined) => {
    if (!r) return 'var(--sem-dado)';
    if (modo === 'apurado') return corApuracao(r.pctApurado);
    if (!r.lider) return 'var(--sem-dado)';
    if (doisTurnos && r.virou) return `url(#hachura-${hachuras.indexOf(corDe(r.lider))})`;
    return corDe(r.lider);
  };
  const opacidade = (r: Resumo | null | undefined) => {
    if (modo !== 'lider' || !r?.lider) return 1;
    if (doisTurnos) return r.pctApurado >= 100 ? 1 : 0.5;
    return 0.45 + 0.55 * Math.min(1, r.lider.pct / 60);
  };
  const escala = vista.w / W; // 1 = mapa inteiro; menor = ampliado

  // 2º turno: um item por finalista, com as amostras de "liderando", "venceu" e "virou".
  const legenda2t = useMemo(() => {
    if (!dados || !doisTurnos || legendaPorPartido) return [];
    const cont = new Map<string, { c: ResumoCandidato; n: number }>();
    for (const r of Object.values(dados)) {
      for (const c of [r?.lider, r?.segundo]) if (c && !cont.has(c.numero)) cont.set(c.numero, { c, n: 0 });
      if (r?.lider) cont.get(r.lider.numero)!.n++;
    }
    return [...cont.values()].sort((a, b) => Number(a.c.numero) - Number(b.c.numero));
  }, [dados, doisTurnos, legendaPorPartido]);

  const legenda = useMemo(() => {
    if (!dados || modo !== 'lider') return [];
    const cont = new Map<string, { nome: string; partido: string; n: number }>();
    for (const r of Object.values(dados)) {
      if (!r?.lider) continue;
      const id = legendaPorPartido ? r.lider.partido : `${r.lider.numero}|${r.lider.partido}`;
      const e = cont.get(id) ?? { nome: legendaPorPartido ? '' : titulo(r.lider.nome), partido: r.lider.partido, n: 0 };
      e.n++;
      cont.set(id, e);
    }
    return [...cont.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }, [dados, modo, legendaPorPartido]);

  const info = hover ? dados?.[hover.k] : null;

  return (
    <div className="mapa" ref={ref} onMouseLeave={() => setHover(null)}>
      {!geo && <EsqueletoMapa />}
      <svg
        ref={svgRef}
        viewBox={`${vista.x} ${vista.y} ${vista.w} ${vista.h}`}
        onPointerDown={aoApertar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        role="img"
        aria-label="Mapa de resultados"
        aria-busy={!dados}
        className={[dados ? '' : 'aguardando', vista.w < W ? 'ampliado' : ''].join(' ').trim() || undefined}
        style={geo ? undefined : { display: 'none' }}
      >
        {hachuras.length > 0 && (
          <defs>
            {hachuras.map((c, i) => (
              <pattern
                key={c}
                id={`hachura-${i}`}
                patternUnits="userSpaceOnUse"
                width={8 * escala}
                height={8 * escala}
                patternTransform="rotate(45)"
              >
                <rect width={8 * escala} height={8 * escala} fill={c} fillOpacity={0.35} />
                <rect width={4 * escala} height={8 * escala} fill={c} />
              </pattern>
            ))}
          </defs>
        )}
        {regioes.map((r) => {
          const res = dados?.[r.k];
          const sel = r.k === selecionado;
          return (
            <path
              key={r.k}
              d={r.d}
              fill={cor(res)}
              fillOpacity={focar && !sel ? opacidade(res) * 0.35 : opacidade(res)}
              className={sel ? 'regiao selecionada' : 'regiao'}
              vectorEffect="non-scaling-stroke"
              onClick={() => {
                if (cliqueSuprimido.current) cliqueSuprimido.current = false;
                else onSelect(r.k);
              }}
              onMouseMove={(e) => {
                if (gesto.current?.arrastou) return;
                const box = ref.current!.getBoundingClientRect();
                setHover({ k: r.k, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
            />
          );
        })}
        {/* Redesenha a selecionada por cima para o contorno não ficar escondido */}
        {selecionado && regioes.filter((r) => r.k === selecionado).map((r) => (
          <path key="sel" d={r.d} className="contorno-selecao" vectorEffect="non-scaling-stroke" />
        ))}
        {rotulos && regioes.map((r) => (
          <text
            key={`r-${r.k}`}
            x={r.c[0]}
            y={r.c[1]}
            className="rotulo-regiao"
            style={{ fontSize: 13 * escala, strokeWidth: 3 * escala }}
            dy="0.35em"
          >
            {r.k.toUpperCase()}
          </text>
        ))}
      </svg>

      {geo && (
        <div className="zoom-controles" role="group" aria-label="Zoom do mapa">
          <button type="button" onClick={() => aplicarZoom(1.6)} disabled={noMaximo} aria-label="Aproximar" title="Aproximar">+</button>
          <button type="button" onClick={() => aplicarZoom(1 / 1.6)} disabled={noMinimo} aria-label="Afastar" title="Afastar">−</button>
          {ampliado && (
            <button type="button" className="zoom-reset" onClick={() => setZoom(null)} title="Voltar ao enquadramento inicial">
              Ajustar
            </button>
          )}
        </div>
      )}

      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(hover.x + 14, (ref.current?.clientWidth ?? 0) - 230),
            top: hover.y + 14,
          }}
        >
          <strong>{nome(hover.k)}</strong>
          {info && doisTurnos && info.lider ? (
            <>
              {[info.lider, info.segundo].filter((c): c is ResumoCandidato => !!c).map((c) => (
                <div key={c.numero} className="tooltip-linha">
                  <span className="bolinha" style={{ background: corDe(c) }} />
                  <span>{titulo(c.nome)} <span className="muted">({c.partido})</span></span>
                  <strong>{fmtPct(c.pct)}</strong>
                </div>
              ))}
              <div className="muted">
                {ROTULO_ESTADO[estado2t(info)]}
                {info.virou && ' (2º no 1º turno)'} · {fmtPct(info.pctApurado)} apurado
              </div>
            </>
          ) : info ? (
            <>
              {info.lider && (
                <div>
                  <span className="bolinha" style={{ background: corPartido(info.lider.partido) }} />
                  {titulo(info.lider.nome)} ({info.lider.partido}) — {fmtPct(info.lider.pct)}
                  <div className="muted">{fmt(info.lider.votos)} votos</div>
                </div>
              )}
              <div className="muted">{fmtPct(info.pctApurado)} das seções apuradas</div>
            </>
          ) : (
            <div className="muted">{dados ? 'Sem dados' : 'Carregando…'}</div>
          )}
        </div>
      )}

      <div className="legenda">
        {modo === 'apurado' ? (
          <div className="legenda-gradiente">
            <span>0%</span>
            <i style={{ background: `linear-gradient(90deg, ${corApuracao(0)}, ${corApuracao(50)}, ${corApuracao(100)})` }} />
            <span>100% apurado</span>
          </div>
        ) : legenda2t.length ? (
          <div className="legenda-2t">
            {legenda2t.map(({ c, n }) => (
              <div key={c.numero} className="legenda-2t-linha">
                <span className="legenda-2t-nome">{titulo(c.nome)}</span>
                <AmostrasEstado cor={corDe(c)} />
                <span className="muted">{n} {rotuloRegiao}</span>
              </div>
            ))}
            <div className="legenda-2t-linha legenda-2t-rotulos muted" aria-hidden="true">
              <span />
              {Object.values(ROTULO_ESTADO).map((t) => <span key={t}>{t}</span>)}
            </div>
          </div>
        ) : legenda.length ? (
          legenda.map((l) => (
            <span key={l.nome + l.partido} className="legenda-item">
              <span className="bolinha" style={{ background: corPartido(l.partido) }} />
              {l.nome ? <>{l.nome}&nbsp;<span className="muted">({l.partido})</span></> : l.partido}
              <span className="muted">&nbsp;· {l.n} {rotuloRegiao}</span>
            </span>
          )).concat(doisTurnos ? [
            <span key="estados" className="legenda-item legenda-estados muted">
              <AmostrasEstado cor="var(--muted)" rotulos />
            </span>,
          ] : [])
        ) : (
          dados && <span className="muted">Nenhum voto apurado ainda nesta área.</span>
        )}
      </div>
    </div>
  );
}

/** Amostras "liderando / venceu / virou" de uma cor (legenda do 2º turno). */
function AmostrasEstado({ cor, rotulos }: { cor: string; rotulos?: boolean }) {
  return (
    <>
      {(['liderando', 'venceu', 'virou'] as const).map((e) => (
        <span key={e} className="amostra-estado" title={ROTULO_ESTADO[e]}>
          <i
            className={e}
            style={e === 'virou'
              ? { backgroundImage: `repeating-linear-gradient(45deg, ${cor} 0 3px, transparent 3px 6px)` }
              : { background: cor }}
          />
          {rotulos && ROTULO_ESTADO[e]}
        </span>
      ))}
    </>
  );
}
