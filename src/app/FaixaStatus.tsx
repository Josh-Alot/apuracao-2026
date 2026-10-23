import { ATUALIZA_RESULTADO_MS } from '../apuracao/useFaseApuracao';
import { ProximaAtualizacao } from '../apuracao/ProximaAtualizacao';
import { fmt, fmtPct } from '../lib/util';
import { LinkTela } from '../rota/Link';
import { Num } from '../ui/Num';
import { destinoTurno, turnosDe } from '../dominio/cargo';
import { rotuloEstado } from '../dominio/fase';
import type { DadosTela } from './useDadosTela';

/** Faixa de status: estado da apuração, seções, última totalização, próxima atualização, "ao vivo" e os turnos. */
export function FaixaStatus({ d, auto, onAuto }: { d: DadosTela; auto: boolean; onAuto: (ligado: boolean) => void }) {
  const { config, cargo, uf, apuracao, precisaUf, mapaBr, resultado } = d;
  const { encerrada, intervaloMapa, apuracaoAberta } = apuracao;
  const r = resultado.data;
  const turnos = turnosDe(config);
  // Cargos estaduais no nível Brasil não têm resultado: quem atualiza é o mapa.
  const fonte = precisaUf ? mapaBr : resultado;

  return (
    <div className="faixa-status">
      <div className="faixa-info">
        <span className="faixa-estado"><i aria-hidden="true" />{rotuloEstado(d.fase, { encerrada, aoVivo: apuracao.aoVivo })}</span>
        {r && (
          <span title={`${fmt(r.secoes.totalizadas)} de ${fmt(r.secoes.total)} seções totalizadas`}>
            Seções {fmt(r.secoes.totalizadas)} / {fmt(r.secoes.total)} · <b className="faixa-pct"><Num valor={r.secoes.pct} formatar={fmtPct} /></b>
          </span>
        )}
        {r?.atualizado && (
          <span title="Horário de Brasília da última publicação do TSE">
            Última totalização {r.atualizado.replace(/^(\d\d\/\d\d)\/\d{4}/, '$1')}
          </span>
        )}
        {r?.totalizado && <span>Totalização final</span>}
        <span className={fonte.carregando ? 'indicador-atualizando' : undefined}>
          <ProximaAtualizacao
            proxima={fonte.proxima}
            intervalo={precisaUf ? intervaloMapa : ATUALIZA_RESULTADO_MS}
            carregando={fonte.carregando}
            aoVivo={precisaUf ? null : resultado.aoVivo}
            inicio={apuracaoAberta ? null : cargo.encerramento}
            encerrada={encerrada}
            compacto
          />
        </span>
        {!encerrada && config.flags.aoVivo && (
          <label
            className="auto"
            title={auto
              ? 'Ao vivo: os resultados chegam assim que o TSE publica (verificação a cada 5 s). Desmarque para atualizar a cada 30 s.'
              : 'Atualização periódica: resultados a cada 30 s e mapa a cada 1 min. Marque para receber ao vivo.'}
          >
            <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} /> ao vivo
          </label>
        )}
      </div>
      {turnos.length > 1 && (
        <nav className="turnos" aria-label="Turno">
          {turnos.map((t) => {
            const c = config.cargos.find((x) => x.turno === t)!;
            const [l, id] = destinoTurno(config, cargo, uf, t);
            return (
              <LinkTela
                key={t}
                para={l}
                cargo={id}
                className={t === cargo.turno ? 'ativo' : undefined}
                aria-current={t === cargo.turno ? 'page' : undefined}
              >
                {t}º turno <span>{c.data.slice(0, 5)}</span>
              </LinkTela>
            );
          })}
        </nav>
      )}
    </div>
  );
}
