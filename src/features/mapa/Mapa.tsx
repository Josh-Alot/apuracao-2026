import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { geoPath, geoTransform, type GeoPath } from 'd3-geo';
import type { Feature, FeatureCollection } from 'geojson';
import type { MapaDados, ModoMapa, Resumo, ResumoCandidato } from '../../lib/types';
import { EsqueletoMapa } from '../../ui/Carregando';
import { useCores } from '../../lib/tema';
import { corApuracao, corPartido, fmt, fmtPct, misturar, titulo } from '../../lib/util';

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
  /** Dica no fim do tooltip de cada região (ex.: "Clique para abrir as zonas →"). */
  dica?: (chave: string) => string | null;
  /** Ao lado da legenda (ex.: o cartão do exterior). */
  rodape?: ReactNode;
  /**
   * Zonas eleitorais da região em foco (`focar`), desenhadas por cima dela com a mesma projeção.
   * Contornos estimados (`properties.zona`), não oficiais.
   */
  zonas?: {
    geo: FeatureCollection;
    dados: MapaDados | null;
    selecionada?: string;
    onSelect: (zona: string) => void;
  };
}

/** Estado de uma região no mapa do 2º turno. */
const estado2t = (r: Resumo) => (r.virou ? 'virou' : r.pctApurado >= 100 ? 'venceu' : 'liderando');
const ROTULO_ESTADO = { liderando: 'Liderando', venceu: 'Venceu', virou: 'Virou' } as const;

/**
 * Intensidade da cor do líder no 1º turno: pela vantagem sobre o 2º colocado (pontos percentuais),
 * 40% abaixo de 10 pts, 70% até 20 e cheia a partir daí. Sem 2º colocado, cheia.
 */
const INTENSIDADES = [0.4, 0.7, 1] as const;
function intensidade(r: Resumo) {
  if (!r.lider || !r.segundo) return 1;
  const v = r.lider.pct - r.segundo.pct;
  return v < 10 ? INTENSIDADES[0] : v < 20 ? INTENSIDADES[1] : INTENSIDADES[2];
}

/** Percorre todas as coordenadas de uma geometria. */
function cadaPonto(g: Feature['geometry'], fn: (x: number, y: number) => void) {
  const anda = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') fn((c as number[])[0], (c as number[])[1]);
    else (c as unknown[]).forEach(anda);
  };
  if (g && 'coordinates' in g) anda(g.coordinates);
}

type Caixa = [number, number, number, number]; // x0, y0, x1, y1
const caixaDe = (g: Feature['geometry']): Caixa => {
  const b: Caixa = [Infinity, Infinity, -Infinity, -Infinity];
  cadaPonto(g, (x, y) => {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  });
  return b;
};
const distancia = (a: Caixa, b: Caixa) =>
  Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));

/** Lado mínimo (unidades do viewBox) de uma região desenhada em quadro à parte. */
const LADO_QUADRO = 70;
/** Folga do quadro à direita para não ficar sob os botões de zoom. */
const FOLGA_ZOOM = 60;

interface Quadro { x: number; y: number; w: number; h: number }

/**
 * Projeção plana (equiretangular com correção cos(lat)) ajustada ao viewBox.
 * É plana de propósito: as malhas do IBGE não seguem a orientação de anéis que
 * as projeções esféricas do d3 exigem, e para um país/estado a distorção é irrelevante.
 *
 * Ilhas oceânicas não entram no enquadramento (achatariam o estado num canto): partes de município
 * longe do resto (Trindade, em Vitória-ES) são descartadas; município inteiro longe do resto
 * (Fernando de Noronha-PE) vai para um quadro no canto do mapa, do lado em que fica.
 */
function projetar(fc: FeatureCollection) {
  // Partes (polígonos) de cada feature; o núcleo cresce a partir da maior, juntando o que está perto.
  const partes = fc.features.flatMap((f, i) => {
    const g = f.geometry;
    const polis = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : [];
    return polis.map((p) => {
      const b = caixaDe({ type: 'Polygon', coordinates: p });
      return { i, p, b, area: (b[2] - b[0]) * (b[3] - b[1]), nucleo: false };
    });
  });
  partes.sort((a, b) => b.area - a.area);
  const nucleo: Caixa = partes.length ? [...partes[0].b] : [0, 0, 1, 1];
  if (partes.length) partes[0].nucleo = true;
  for (let mudou = true; mudou;) {
    mudou = false;
    const limite = Math.max(0.5, 0.1 * Math.hypot(nucleo[2] - nucleo[0], nucleo[3] - nucleo[1]));
    for (const p of partes) {
      if (p.nucleo || distancia(p.b, nucleo) > limite) continue;
      p.nucleo = mudou = true;
      nucleo[0] = Math.min(nucleo[0], p.b[0]); nucleo[1] = Math.min(nucleo[1], p.b[1]);
      nucleo[2] = Math.max(nucleo[2], p.b[2]); nucleo[3] = Math.max(nucleo[3], p.b[3]);
    }
  }

  const [x0, y0, x1, y1] = nucleo;
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const s = Math.min((W - 2 * MARGEM) / ((x1 - x0) * k), (H - 2 * MARGEM) / (y1 - y0));
  const ox = (W - (x1 - x0) * k * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  const plano = (t: (x: number, y: number) => [number, number]) =>
    geoPath(geoTransform({ point(x, y) { this.stream.point(...t(x, y)); } }));
  const principal = plano((x, y) => [ox + (x - x0) * k * s, oy + (y1 - y) * s]);

  const quadros: Quadro[] = [];
  const desenhos = fc.features.map((f, i) => {
    const minhas = partes.filter((p) => p.i === i);
    const perto = minhas.filter((p) => p.nucleo);
    if (perto.length === minhas.length) return { f, path: principal };
    if (perto.length) {
      // Descarta só as partes distantes; o município continua no mapa principal.
      const geometry = { type: 'MultiPolygon' as const, coordinates: perto.map((p) => p.p) };
      return { f: { ...f, geometry }, path: principal };
    }
    // Município inteiro distante: quadro no canto do lado em que ele fica, ampliado até LADO_QUADRO.
    const [a, b, c, d] = caixaDe(f.geometry);
    const fator = Math.max(1, LADO_QUADRO / Math.max((c - a) * k * s, (d - b) * s));
    const w = (c - a) * k * s * fator;
    const h = (d - b) * s * fator;
    const leste = (a + c) / 2 > (x0 + x1) / 2;
    const norte = (b + d) / 2 > (y0 + y1) / 2;
    const pad = 10;
    const empilhados = quadros.length * (LADO_QUADRO + 3 * pad);
    const qx = leste ? W - MARGEM - FOLGA_ZOOM - w - 2 * pad : MARGEM;
    const qy = norte ? MARGEM + empilhados : H - MARGEM - h - 2 * pad - empilhados;
    quadros.push({ x: qx, y: qy, w: w + 2 * pad, h: h + 2 * pad });
    return { f, path: plano((x, y) => [qx + pad + (x - a) * k * s * fator, qy + pad + (d - y) * s * fator]) };
  });
  return { desenhos, quadros };
}

export function Mapa({
  geo, chave, nome, dados, modo, selecionado, focar, rotuloRegiao, legendaPorPartido, segundoTurno, corLider, rotulos, onSelect,
  dica, rodape, zonas,
}: Props) {
  const tema = useCores();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ k: string; zona?: boolean; x: number; y: number } | null>(null);

  const { regioes, quadros, caminhos } = useMemo(() => {
    if (!geo) return { regioes: [], quadros: [], caminhos: new Map<string, GeoPath>() };
    const { desenhos, quadros } = projetar(geo);
    const caminhos = new Map<string, GeoPath>();
    const regioes = desenhos
      .map(({ f, path }) => {
        const k = chave(f);
        if (k) caminhos.set(k, path);
        return { k, d: path(f) ?? '', b: path.bounds(f), c: path.centroid(f) };
      })
      .filter((r): r is { k: string; d: string; b: [[number, number], [number, number]]; c: [number, number] } => !!r.k);
    return { regioes, quadros, caminhos };
  }, [geo, chave]);

  // Zonas: a projeção da região em foco (a do mapa principal ou a do quadro, se for uma ilha).
  const desenhoZonas = useMemo(() => {
    const path = focar ? caminhos.get(focar) : undefined;
    if (!path || !zonas) return [];
    return zonas.geo.features.map((f) => ({ k: String(f.properties?.zona), d: path(f) ?? '', b: path.bounds(f) }));
  }, [caminhos, focar, zonas?.geo]);

  // Enquadramento padrão: o mapa inteiro, a região em foco ou, dentro dela, a zona selecionada.
  const zonaFoco = zonas?.selecionada ? desenhoZonas.find((z) => z.k === zonas.selecionada) : undefined;
  const base = useMemo<Vista>(() => {
    const alvo = zonaFoco ?? (focar ? regioes.find((r) => r.k === focar) : undefined);
    if (!alvo) return { x: 0, y: 0, w: W, h: H };
    const [[a, b], [c, d]] = alvo.b;
    // Lado mínimo menor para a zona: com o do município, as zonas de uma capital nem ampliariam.
    const lado = Math.max(c - a, (d - b) * (W / H), zonaFoco ? 20 : 60) * 1.8;
    const alt = lado * (H / W);
    return { x: (a + c) / 2 - lado / 2, y: (b + d) / 2 - alt / 2, w: lado, h: alt };
  }, [focar, regioes, zonaFoco]);

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

  // Cor de preenchimento do candidato, já ajustada ao tema (no escuro, PL/UP clareiam para não sumir).
  const corDe = (l: ResumoCandidato) => tema.preench(corLider ? corLider(l) : corPartido(l.partido));
  const doisTurnos = segundoTurno && modo === 'lider';
  // Hachuras do "virou": uma por cor, com listras de largura fixa na tela (acompanham o zoom).
  const hachuras = useMemo(() => {
    if (!doisTurnos || !dados) return [];
    const todas = [...Object.values(dados), ...Object.values(zonas?.dados ?? {})];
    return [...new Set(todas.filter((r) => r?.virou && r.lider).map((r) => corDe(r!.lider!)))];
  }, [doisTurnos, dados, zonas?.dados, tema, corLider]);
  const cor = (r: Resumo | null | undefined) => {
    if (!r) return tema.semDado;
    if (modo === 'apurado') return corApuracao(r.pctApurado, tema.escuro);
    if (!r.lider) return tema.semDado;
    const base = corDe(r.lider);
    if (doisTurnos) {
      if (r.virou) return `url(#hachura-${hachuras.indexOf(base)})`;
      return r.pctApurado >= 100 ? base : misturar(base, tema.superficie, 0.5);
    }
    return misturar(base, tema.superficie, intensidade(r));
  };
  // Só a região/zona em foco fica com a cor cheia; as outras, atenuadas.
  const opacidade = (atenuar: boolean) => (atenuar ? 0.35 : 1);
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
    const cont = new Map<string, { nome: string; partido: string; lider: ResumoCandidato; n: number }>();
    for (const r of Object.values(dados)) {
      if (!r?.lider) continue;
      const id = legendaPorPartido ? r.lider.partido : `${r.lider.numero}|${r.lider.partido}`;
      const e = cont.get(id) ?? { nome: legendaPorPartido ? '' : titulo(r.lider.nome), partido: r.lider.partido, lider: r.lider, n: 0 };
      e.n++;
      cont.set(id, e);
    }
    return [...cont.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }, [dados, modo, legendaPorPartido]);

  const info = hover ? (hover.zona ? zonas?.dados : dados)?.[hover.k] : null;
  const pairar = (k: string, zona?: boolean) => (e: React.MouseEvent) => {
    if (gesto.current?.arrastou) return;
    const box = ref.current!.getBoundingClientRect();
    setHover({ k, zona, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const clicar = (fn: () => void) => () => {
    if (cliqueSuprimido.current) cliqueSuprimido.current = false;
    else fn();
  };

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
        {quadros.map((q, i) => (
          <rect key={`q-${i}`} x={q.x} y={q.y} width={q.w} height={q.h} className="quadro-ilha" vectorEffect="non-scaling-stroke" />
        ))}
        {regioes.map((r) => {
          const res = dados?.[r.k];
          const sel = r.k === selecionado;
          return (
            <path
              key={r.k}
              d={r.d}
              // Com as zonas por cima, o município não é pintado: a cor dele vazaria pelas zonas atenuadas.
              fill={desenhoZonas.length && r.k === focar ? 'none' : cor(res)}
              fillOpacity={opacidade(!!focar && !sel)}
              className={sel ? 'regiao selecionada' : 'regiao'}
              vectorEffect="non-scaling-stroke"
              onClick={clicar(() => onSelect(r.k))}
              onMouseMove={pairar(r.k)}
            />
          );
        })}
        {zonas && desenhoZonas.map((z) => (
          <path
            key={`z-${z.k}`}
            d={z.d}
            fill={cor(zonas.dados?.[z.k])}
            fillOpacity={opacidade(!!zonaFoco && z !== zonaFoco)}
            className={z.k === zonas.selecionada ? 'regiao zona selecionada' : 'regiao zona'}
            vectorEffect="non-scaling-stroke"
            onClick={clicar(() => zonas.onSelect(z.k))}
            onMouseMove={pairar(z.k, true)}
          />
        ))}
        {/* Redesenha a selecionada por cima para o contorno não ficar escondido */}
        {selecionado && regioes.filter((r) => r.k === selecionado).map((r) => (
          <path key="sel" d={r.d} className="contorno-selecao" vectorEffect="non-scaling-stroke" />
        ))}
        {zonas?.selecionada && desenhoZonas.filter((z) => z.k === zonas.selecionada).map((z) => (
          <path key="sel-zona" d={z.d} className="contorno-selecao" vectorEffect="non-scaling-stroke" />
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
            left: Math.max(0, Math.min(hover.x + 14, (ref.current?.clientWidth ?? 0) - 236)),
            top: hover.y + 14,
          }}
        >
          <strong className="tooltip-nome">{hover.zona ? `Zona ${Number(hover.k)}` : nome(hover.k)}</strong>
          {info ? (
            <>
              <div className="muted tooltip-meta">
                {info.eleitorado != null && `${fmt(info.eleitorado)} eleitores · `}
                {fmtPct(info.pctApurado)} apurado
              </div>
              {[info.lider, info.segundo].filter((c): c is ResumoCandidato => !!c).map((c, i) => (
                <div key={c.numero} className={`tooltip-linha ${i === 0 ? 'lider' : ''}`}>
                  <i className="amostra" style={{ background: corDe(c) }} />
                  <span>{titulo(c.nome)} <span className="muted">({c.partido})</span></span>
                  <span>{fmtPct(c.pct)}</span>
                </div>
              ))}
              {doisTurnos && info.lider && (
                <div className="muted">
                  {ROTULO_ESTADO[estado2t(info)]}
                  {info.virou && ' (2º no 1º turno)'}
                </div>
              )}
              {!info.lider && modo === 'lider' && <div className="muted">Nenhum voto apurado ainda</div>}
            </>
          ) : (
            <div className="muted">{(hover.zona ? zonas?.dados : dados) ? 'Sem dados' : 'Carregando…'}</div>
          )}
          {!hover.zona && dica?.(hover.k) && <div className="tooltip-dica">{dica(hover.k)}</div>}
        </div>
      )}

      <div className="mapa-rodape">
        <div className="legenda">
          {modo === 'apurado' ? (
            <div className="legenda-gradiente">
              <span>0%</span>
              <i style={{ background: `linear-gradient(90deg, ${[0, 50, 100].map((p) => corApuracao(p, tema.escuro)).join(', ')})` }} />
              <span>100% apurado</span>
            </div>
          ) : legenda2t.length ? (
            <>
              {legenda2t.map(({ c, n }) => (
                <div key={c.numero} className="legenda-linha">
                  <AmostrasEstado cor={corDe(c)} />
                  <span className="legenda-nome">{titulo(c.nome)}</span>
                  <span>{n} {rotuloRegiao}</span>
                </div>
              ))}
              <div className="legenda-linha legenda-escala">
                <span />
                <span>{Object.values(ROTULO_ESTADO).join(' · ')}</span>
              </div>
            </>
          ) : legenda.length ? (
            <>
              {legenda.map((l) => (
                <div key={l.nome + l.partido} className="legenda-linha">
                  <span className="amostras">
                    {INTENSIDADES.map((t) => <i key={t} style={{ background: misturar(corDe(l.lider), tema.superficie, t) }} />)}
                  </span>
                  <span className="legenda-nome">{l.nome ? <>{l.nome} <span className="muted">({l.partido})</span></> : l.partido}</span>
                  <span>{l.n} {rotuloRegiao}</span>
                </div>
              ))}
              {doisTurnos ? (
                <div className="legenda-linha legenda-escala">
                  <AmostrasEstado cor="var(--muted)" />
                  <span>{Object.values(ROTULO_ESTADO).join(' · ')}</span>
                </div>
              ) : (
                <div className="legenda-linha legenda-escala">
                  <span />
                  <span>Vantagem &lt;10 · 10–20 · 20+ pts</span>
                </div>
              )}
            </>
          ) : (
            dados && <span>Nenhum voto apurado ainda nesta área.</span>
          )}
        </div>
        {rodape}
      </div>
    </div>
  );
}

/** Amostras "liderando / venceu / virou" de uma cor (legenda do 2º turno). */
function AmostrasEstado({ cor }: { cor: string }) {
  const tema = useCores();
  return (
    <span className="amostras">
      {(['liderando', 'venceu', 'virou'] as const).map((e) => (
        <i
          key={e}
          title={ROTULO_ESTADO[e]}
          style={e === 'virou'
            ? { backgroundImage: `repeating-linear-gradient(45deg, ${cor} 0 3px, transparent 3px 6px)` }
            : { background: e === 'liderando' && cor.startsWith('#') ? misturar(cor, tema.superficie, 0.5) : cor, opacity: e === 'liderando' && !cor.startsWith('#') ? 0.5 : undefined }}
        />
      ))}
    </span>
  );
}
