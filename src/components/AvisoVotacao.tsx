import { useEffect, useState } from 'react';
import type { Cargo } from '../types';

export type FaseVotacao = 'antes' | 'votando' | 'aguardando' | 'indisponivel' | 'apurando';

/**
 * Em que momento da eleição estamos, pelo relógio e pelo % já apurado.
 * `tseIndisponivel`: depois do fechamento, nenhum dado chegou porque a consulta ao TSE falhou.
 */
export function faseVotacao(cargo: Cargo, agora: number, pctApurado: number | null, tseIndisponivel = false): FaseVotacao {
  if (!cargo.abertura || !cargo.encerramento) return 'apurando';
  if (agora < Date.parse(cargo.abertura)) return 'antes';
  if (agora < Date.parse(cargo.encerramento)) return 'votando';
  if (pctApurado) return 'apurando';
  return tseIndisponivel ? 'indisponivel' : 'aguardando';
}

/** Relógio que só "anda" enquanto `ativo` (atualiza a cada 15 s — a contagem é em minutos). */
export function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    if (!ativo) return;
    const id = setInterval(() => setAgora(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [ativo]);
  return agora;
}

function falta(ms: number) {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    .replace(':00', 'h').replace(':', 'h');

const dia = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });

interface Props {
  cargo: Cargo;
  fase: FaseVotacao;
  agora: number;
}

/** Faixa de aviso exibida enquanto não há resultados a divulgar. */
export function AvisoVotacao({ cargo, fase, agora }: Props) {
  if (fase === 'apurando' || !cargo.abertura || !cargo.encerramento) return null;
  const turno = `${cargo.turno}º turno`;
  const fim = hora(cargo.encerramento);

  return (
    <aside className={`aviso-votacao aviso-${fase}`} role="status" aria-live="polite">
      {fase === 'antes' && (
        <>
          <strong>A votação do {turno} ainda não começou.</strong>
          <span>
            Será {dia(cargo.abertura)}, das {hora(cargo.abertura)} às {fim} (horário de Brasília).
            Os resultados começam a ser divulgados pelo TSE após o fechamento das urnas.
          </span>
        </>
      )}
      {fase === 'votando' && (
        <>
          <strong>Votação em andamento.</strong>
          <span>
            As urnas fecham às {fim} (horário de Brasília) — faltam <b>{falta(Date.parse(cargo.encerramento) - agora)}</b>.
            Até lá o TSE não divulga resultados — nem os do exterior —, por isso os números abaixo estão zerados.
            A atualização automática começa às {fim}.
          </span>
        </>
      )}
      {fase === 'aguardando' && (
        <>
          <strong>Urnas fechadas.</strong>
          <span>
            Aguardando os primeiros boletins do TSE; esta página se atualiza sozinha assim que a apuração começar.
          </span>
        </>
      )}
      {fase === 'indisponivel' && (
        <>
          <strong>TSE indisponível no momento.</strong>
          <span>
            O site de resultados do TSE não respondeu às últimas consultas (costuma ser sobrecarga passageira).
            Os números aparecem aqui assim que ele voltar — não é preciso recarregar a página.
          </span>
        </>
      )}
    </aside>
  );
}
