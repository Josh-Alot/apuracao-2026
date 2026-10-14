import type { Cargo } from '../lib/types';

/** Caixa "Próximo plantão": o 2º turno já está na config e a votação ainda não começou. */
export function ProximoPlantao({ cargo }: { cargo: Cargo }) {
  const [d, m, a] = cargo.data.split('/').map(Number);
  const semana = new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
  const hora = (iso: string | null) => (iso
    ? new Date(iso).toLocaleTimeString('pt-BR', { hour: 'numeric', timeZone: 'America/Sao_Paulo' }).replace(/:00$/, '').replace(/^0/, '') + 'h'
    : '');
  return (
    <section className="proximo-plantao">
      <span className="rotulo-secao">Próximo plantão</span>
      <strong>2º turno · {semana}, {cargo.data.slice(0, 5)}</strong>
      <p>
        Urnas abertas das {hora(cargo.abertura)} às {hora(cargo.encerramento)} (Brasília). Resultados ao vivo a partir
        das {hora(cargo.encerramento)}.
      </p>
    </section>
  );
}
