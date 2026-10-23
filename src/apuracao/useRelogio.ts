import { useEffect, useState } from 'react';

/**
 * Relógio (Date.now) que só "anda" enquanto `ativo`, a cada `intervaloMs`; ao ligar, já marca a hora certa.
 * Usos: a fase da apuração (15 s: liga o "ao vivo" às 17h), a contagem regressiva do fechamento e a da
 * próxima atualização (1 s).
 */
export function useRelogio(ativo: boolean, intervaloMs: number) {
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [ativo, intervaloMs]);
  return agora;
}
