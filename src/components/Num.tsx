import { useEffect, useRef, useState } from 'react';

const DURACAO_MS = 900;
const reduzMovimento = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  valor: number;
  formatar: (n: number) => string;
  className?: string;
}

/**
 * Número ao vivo: quando `valor` muda, conta do valor antigo até o novo e recebe a classe
 * `mudou` por alguns instantes (realce). O estado "atualizando" vem do CSS do contêiner
 * (`.atualizando .num`), para não precisar repassar a flag a cada número.
 */
export function Num({ valor, formatar, className = '' }: Props) {
  const [exibido, setExibido] = useState(valor);
  const [mudou, setMudou] = useState(false);
  const anterior = useRef(valor);

  useEffect(() => {
    const de = anterior.current;
    anterior.current = valor;
    if (de === valor) return;

    setMudou(true);
    const fimRealce = setTimeout(() => setMudou(false), 1400);
    if (reduzMovimento()) {
      setExibido(valor);
      return () => clearTimeout(fimRealce);
    }
    const inicio = performance.now();
    let quadro = 0;
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / DURACAO_MS);
      const suave = 1 - Math.pow(1 - t, 3); // ease-out cúbico
      setExibido(t === 1 ? valor : de + (valor - de) * suave);
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => {
      cancelAnimationFrame(quadro);
      clearTimeout(fimRealce);
      setExibido(valor);
    };
  }, [valor]);

  return (
    <span className={`num ${mudou ? 'mudou' : ''} ${className}`}>
      {formatar(Number.isInteger(valor) ? Math.round(exibido) : exibido)}
    </span>
  );
}
