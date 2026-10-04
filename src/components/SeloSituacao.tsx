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

/** Selos de situação (eleito, 2º turno, suplente, não eleito) e de votos anulados. */
export function SeloSituacao({ c }: { c: Candidato }) {
  const destino = c.destinoVotos && c.destinoVotos !== 'Válido' ? c.destinoVotos : null;
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
      {c.status === 'suplente' && (
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
