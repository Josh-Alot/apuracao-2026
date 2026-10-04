import { useEffect, useState } from 'react';
import type { AoVivo } from '../api';

interface Props {
  /** Horário (ms) da próxima consulta automática; null = atualização pausada. */
  proxima: number | null;
  intervalo: number;
  carregando?: boolean;
  /** Ex.: "Resultados", "Mapa". */
  rotulo?: string;
  /** Presente quando os dados chegam pelo stream "ao vivo" em vez de consultas periódicas. */
  aoVivo?: AoVivo | null;
  /** Antes da apuração: quando as consultas ao TSE começam (ISO). */
  inicio?: string | null;
}

const EXPLICACAO =
  'O TSE publica novos números à medida que as urnas são totalizadas (no pico, a cada poucos segundos). ' +
  'Esta página consulta o TSE automaticamente nesse intervalo; o horário "atualizado em" é o da última publicação do TSE.';

const fmtIntervalo = (ms: number) => (ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`);

/** "Atualiza a cada 30 s · próxima em 12 s", com contagem regressiva por segundo. */
export function ProximaAtualizacao({ proxima, intervalo, carregando, rotulo = 'Atualização automática', aoVivo, inicio }: Props) {
  const [agora, setAgora] = useState(Date.now);
  const relogio = !!proxima || !!aoVivo;
  useEffect(() => {
    if (!relogio) return;
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [relogio]);

  if (aoVivo) {
    const s = aoVivo.intervalo / 1000;
    const ha = aoVivo.verificadoEm ? Math.max(0, Math.round((agora - aoVivo.verificadoEm) / 1000)) : null;
    if (!aoVivo.conectado) return <span className="proxima ao-vivo-off">Reconectando ao vivo…</span>;
    return (
      <span className="proxima proxima-ao-vivo" title={`Conectado: o servidor verifica o TSE a cada ${s} s e envia os números assim que mudam.`}>
        <i className="ponto-ao-vivo" aria-hidden />
        Ao vivo · TSE verificado {ha === null ? 'agora' : ha <= 1 ? 'agora mesmo' : `há ${ha} s`}
      </span>
    );
  }

  if (!proxima && inicio) {
    const hora = new Date(inicio).toLocaleTimeString('pt-BR', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
      .replace(':00', 'h').replace(':', 'h');
    return (
      <span className="proxima pausada" title="O TSE só divulga resultados após o fechamento das urnas; até lá esta página não consulta o TSE.">
        Atualização automática começa às {hora} (Brasília)
      </span>
    );
  }
  if (!proxima) {
    return <span className="proxima pausada" title={EXPLICACAO}>Atualização automática pausada</span>;
  }
  const resta = Math.max(0, Math.ceil((proxima - agora) / 1000));
  return (
    <span className="proxima" title={EXPLICACAO}>
      {rotulo} a cada {fmtIntervalo(intervalo)} · {carregando ? 'consultando o TSE…' : `próxima em ${resta} s`}
      <i className="proxima-anel" style={{ ['--p' as string]: `${(1 - resta / (intervalo / 1000)) * 100}%` }} aria-hidden />
    </span>
  );
}
