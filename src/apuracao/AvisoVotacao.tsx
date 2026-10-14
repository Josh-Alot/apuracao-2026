import { useEffect, useState } from 'react';
import type { Cargo } from '../lib/types';

export type FaseVotacao = 'antes' | 'votando' | 'carregando' | 'aguardando' | 'indisponivel' | 'apurando';

/**
 * Em que momento da eleição estamos, pelo relógio e pelo % já apurado.
 * `tseIndisponivel`: depois do fechamento, nenhum dado chegou porque a consulta ao TSE falhou.
 * `carregando`: os dados da aba ainda estão a caminho — não dá para saber se há boletins.
 */
export function faseVotacao(
  cargo: Cargo, agora: number, pctApurado: number | null, tseIndisponivel = false, carregando = false,
): FaseVotacao {
  if (!cargo.abertura || !cargo.encerramento) return 'apurando';
  if (agora < Date.parse(cargo.abertura)) return 'antes';
  if (agora < Date.parse(cargo.encerramento)) return 'votando';
  if (pctApurado) return 'apurando';
  if (carregando) return 'carregando';
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

/** "03:12:45" até o fechamento. */
function contagem(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Relógio de 1 s, só enquanto a contagem regressiva está na tela. */
function useSegundos(ativo: boolean) {
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ativo]);
  return agora;
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

/** Faixa de largura total, acima da faixa de status, enquanto não há resultados a divulgar. */
export function AvisoVotacao({ cargo, fase, agora: agoraMinuto }: Props) {
  const agora = useSegundos(fase === 'votando');
  if (fase === 'apurando' || fase === 'carregando' || !cargo.abertura || !cargo.encerramento) return null;
  const turno = `${cargo.turno}º turno`;
  const fim = hora(cargo.encerramento);
  const [titulo, frase] = {
    antes: [
      `A votação do ${turno} ainda não começou`,
      `Será ${dia(cargo.abertura)}, das ${hora(cargo.abertura)} às ${fim} (horário de Brasília). Os resultados começam a ser divulgados pelo TSE após o fechamento das urnas.`,
    ],
    votando: [
      'Votação em andamento',
      `O TSE só divulga resultados depois que as urnas fecham. Esta página passa a atualizar sozinha às ${fim}.`,
    ],
    aguardando: [
      'Urnas fechadas',
      'Aguardando os primeiros boletins do TSE; esta página se atualiza sozinha assim que a apuração começar.',
    ],
    indisponivel: [
      'TSE indisponível no momento',
      'O site de resultados do TSE não respondeu às últimas consultas (costuma ser sobrecarga passageira). Os números aparecem aqui assim que ele voltar — não é preciso recarregar a página.',
    ],
  }[fase];

  return (
    <aside className={`aviso-votacao aviso-${fase}`}>
      <div className="aviso-texto" role="status" aria-live="polite">
        <strong>{titulo}</strong>
        <span>{frase}</span>
      </div>
      {fase === 'votando' && (
        <div className="aviso-contagem" title={`Faltam ${Math.ceil((Date.parse(cargo.encerramento) - agoraMinuto) / 60_000)} min`}>
          <span>Urnas fecham em</span>
          <b>{contagem(Date.parse(cargo.encerramento) - agora)}</b>
        </div>
      )}
    </aside>
  );
}
