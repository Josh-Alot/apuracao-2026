import { memo, useState } from 'react';

/** Campo "ir para…" com a lista de municípios da UF (centenas de opções): memoizado, não muda com o resultado. */
export const SeletorMunicipio = memo(function SeletorMunicipio({ rotulo, municipios, onEscolher }: {
  rotulo: string; municipios: { cd: string; nome: string }[]; onEscolher: (cd: string) => void;
}) {
  const [valor, setValor] = useState('');
  return (
    <label className="campo-rotulado seletor-municipio">
      <span>{rotulo}</span>
      <input
        list="lista-municipios"
        placeholder="ir para…"
        disabled={municipios.length === 0}
        value={valor}
        onChange={(e) => {
          setValor(e.target.value);
          const m = municipios.find((x) => x.nome.toLowerCase() === e.target.value.toLowerCase());
          if (m) { onEscolher(m.cd); setValor(''); }
        }}
      />
      <datalist id="lista-municipios">
        {municipios.map((m) => <option key={m.cd} value={m.nome} />)}
      </datalist>
    </label>
  );
});
