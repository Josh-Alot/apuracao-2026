/** Aviso acima do mapa: falha/timeout ao carregar, ou regiões que ainda não chegaram do TSE. */
export function AvisoMapa({ erro, temDados, regioes, semDado, rotulo, intervalo }: {
  erro: string | null; temDados: boolean; regioes: number; semDado: number; rotulo: string; intervalo: number;
}) {
  const novaTentativa = intervalo
    ? `Nova tentativa em ${Math.round(intervalo / 1000)} s.`
    : 'Recarregue a página para tentar de novo.';
  if (erro) {
    return (
      <div className="aviso-mapa aviso-mapa-erro" role="status">
        <strong>Não foi possível {temDados ? 'atualizar' : 'carregar'} o mapa</strong>
        <p>{erro}. {novaTentativa}</p>
      </div>
    );
  }
  if (!semDado) return null;
  const chegaram = regioes - semDado;
  return (
    <div className="aviso-mapa" role="status">
      <strong>
        {chegaram === 0
          ? `Mapa carregando: os ${regioes} ${rotulo} ainda estão chegando do TSE`
          : `Mapa incompleto: ${chegaram} de ${regioes} ${rotulo}`}
      </strong>
      <div className="aviso-mapa-barra" aria-hidden="true">
        <span style={{ width: `${(100 * chegaram) / regioes}%` }} />
      </div>
      <p>
        Faltam {semDado} {rotulo}. O servidor consulta o TSE aos poucos para não ser bloqueado, e o mapa se
        completa a cada atualização — as regiões em branco ainda não chegaram.
      </p>
    </div>
  );
}
