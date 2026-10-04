import type { Candidato } from '../types';

const EXPLICA_DETALHE: Record<string, string> = {
  'por QP': 'Eleito pelo quociente partidário: a votação do partido/federação garantiu a vaga.',
  'por média': 'Eleito pelas sobras (maiores médias), na distribuição das vagas que restaram.',
};

const EXPLICA_DESTINO: Record<string, string> = {
  Anulado: 'O registro do candidato foi indeferido/cassado: os votos dele são considerados nulos.',
  'Anulado sub judice': 'O registro está em disputa na Justiça: os votos ficam anulados até a decisão final.',
  'Válido (legenda)': 'Os votos do candidato são contados apenas para o partido (legenda).',
};

const EXPLICA_MATEMATICO =
  'Mesmo que todos os eleitores das seções ainda não apuradas votassem nos adversários, a vaga já está ' +
  'garantida. O TSE só declara o resultado oficial ao fim da totalização.';

const EXPLICA_2TURNO =
  'Mesmo que todos os eleitores das seções ainda não apuradas votassem nos adversários, ninguém mais ' +
  'alcança a maioria dos votos válidos e o candidato fica entre os dois mais votados.';

const PROJECAO = ' Projeção pelas vagas que o TSE calcula para cada chapa com os votos apurados até agora; o resultado oficial sai ao fim da totalização.';

/** Na projeção, a suplência só aparece para os primeiros da fila (senão a lista inteira ganharia selo). */
const SUPLENTES_NA_PROJECAO = 5;

/** Selos de situação (eleito, 2º turno, suplente, não eleito) e de votos anulados. */
export function SeloSituacao({ c }: { c: Candidato }) {
  const destino = c.destinoVotos && c.destinoVotos !== 'Válido' ? c.destinoVotos : null;
  const ch = c.chapa;
  const qe = ch ? ch.qe.toLocaleString('pt-BR') : '';
  const sufixo = ch?.projecao ? ' (projeção)' : '';
  const nota = ch?.projecao ? PROJECAO : '';
  const ordemSuplente = ch?.suplente && (!ch.projecao ? c.status === 'suplente' : !c.status && ch.suplente <= SUPLENTES_NA_PROJECAO)
    ? ch.suplente : null;
  return (
    <>
      {c.status === 'eleito' && (
        <span className="selo selo-eleito" title={c.detalhe ? EXPLICA_DETALHE[c.detalhe] : undefined}>
          Eleito(a){c.detalhe && ` ${c.detalhe}`}
        </span>
      )}
      {c.matematicamente === 'eleito' && c.status !== 'eleito' && (
        <span className="selo selo-matematico" title={EXPLICA_MATEMATICO}>Matematicamente eleito(a)</span>
      )}
      {c.matematicamente === 'segundo-turno' && c.status !== 'segundo-turno' && (
        <span className="selo selo-matematico selo-2turno" title={EXPLICA_2TURNO}>2º turno garantido</span>
      )}
      {c.status === 'segundo-turno' && <span className="selo selo-2turno">2º turno</span>}
      {ch?.puxadoPor && (
        <span className="selo selo-puxado" title={`Teve menos votos que o quociente eleitoral (${qe}) e entrou com a votação da chapa, puxada por ${ch.puxadoPor}.${nota}`}>
          Puxado(a) por {ch.puxadoPor}{sufixo}
        </span>
      )}
      {ch && ch.puxou > 0 && (
        <span className="selo selo-puxador" title={`Passou do quociente eleitoral (${qe}) e a sobra dos votos ajudou a eleger ${ch.puxou} colega(s) de chapa com menos votos que o QE.${nota}`}>
          Puxador(a): +{ch.puxou}{sufixo}
        </span>
      )}
      {ordemSuplente ? (
        <span className="selo selo-suplente" title={`${ordemSuplente}º na fila da chapa para assumir quando um eleito do mesmo partido/federação deixar o cargo.${nota}`}>
          {ordemSuplente}º suplente{sufixo}
        </span>
      ) : c.status === 'suplente' && (
        <span className="selo selo-suplente" title="Assume se um eleito do mesmo partido/federação deixar o cargo.">Suplente</span>
      )}
      {c.status === 'nao-eleito' && <span className="selo selo-nao-eleito">Não eleito(a)</span>}
      {c.status === 'outro' && c.detalhe && <span className="selo">{c.detalhe}</span>}
      {destino && (
        <span className="selo selo-anulado" title={EXPLICA_DESTINO[destino]}>
          {destino.startsWith('Anulado') ? `Votos ${destino.toLowerCase()}` : 'Votos só para a legenda'}
        </span>
      )}
    </>
  );
}
