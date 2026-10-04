import { useMemo, useRef, useState } from 'react';
import { geoPath, geoTransform } from 'd3-geo';
import type { Feature, FeatureCollection } from 'geojson';
import type { MapaDados, ModoMapa, Resumo } from '../types';
import { EsqueletoMapa } from './Carregando';
import { corApuracao, corPartido, fmt, fmtPct, titulo } from '../util';

const W = 1000;
const H = 820;
const MARGEM = 12;

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
  onSelect: (chave: string) => void;
}

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

export function Mapa({ geo, chave, nome, dados, modo, selecionado, focar, rotuloRegiao, legendaPorPartido, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ k: string; x: number; y: number } | null>(null);

  const regioes = useMemo(() => {
    if (!geo) return [];
    const path = projetar(geo);
    return geo.features
      .map((f) => ({ k: chave(f), d: path(f) ?? '', b: path.bounds(f) }))
      .filter((r): r is { k: string; d: string; b: [[number, number], [number, number]] } => !!r.k);
  }, [geo, chave]);

  const viewBox = useMemo(() => {
    const alvo = focar && regioes.find((r) => r.k === focar);
    if (!alvo) return `0 0 ${W} ${H}`;
    const [[a, b], [c, d]] = alvo.b;
    const lado = Math.max(c - a, (d - b) * (W / H), 60) * 1.8;
    const alt = lado * (H / W);
    return `${(a + c) / 2 - lado / 2} ${(b + d) / 2 - alt / 2} ${lado} ${alt}`;
  }, [focar, regioes]);

  const cor = (r: Resumo | null | undefined) => {
    if (!r) return 'var(--sem-dado)';
    if (modo === 'apurado') return corApuracao(r.pctApurado);
    return r.lider ? corPartido(r.lider.partido) : 'var(--sem-dado)';
  };
  const opacidade = (r: Resumo | null | undefined) =>
    modo === 'lider' && r?.lider ? 0.45 + 0.55 * Math.min(1, r.lider.pct / 60) : 1;

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
        viewBox={viewBox}
        role="img"
        aria-label="Mapa de resultados"
        aria-busy={!dados}
        className={dados ? '' : 'aguardando'}
        style={geo ? undefined : { display: 'none' }}
      >
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
              onClick={() => onSelect(r.k)}
              onMouseMove={(e) => {
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
      </svg>

      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(hover.x + 14, (ref.current?.clientWidth ?? 0) - 230),
            top: hover.y + 14,
          }}
        >
          <strong>{nome(hover.k)}</strong>
          {info ? (
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
        ) : legenda.length ? (
          legenda.map((l) => (
            <span key={l.nome + l.partido} className="legenda-item">
              <span className="bolinha" style={{ background: corPartido(l.partido) }} />
              {l.nome ? <>{l.nome}&nbsp;<span className="muted">({l.partido})</span></> : l.partido}
              <span className="muted">&nbsp;· {l.n} {rotuloRegiao}</span>
            </span>
          ))
        ) : (
          dados && <span className="muted">Nenhum voto apurado ainda nesta área.</span>
        )}
      </div>
    </div>
  );
}
