import { useMemo } from 'react';
import { UF_NOMES, fmt, titulo } from '../lib/util';
import { LinkTela } from '../rota/Link';
import { SeletorMunicipio } from '../ui/SeletorMunicipio';
import { cargoBase, nomeCargo } from '../dominio/cargo';
import type { DadosTela } from './useDadosTela';

/** Cabeçalho das telas de UF, município e zona: trilha (Brasil / UF / município / zona), seletor e título. */
export function CabecalhoTela({ d, nomeRegiao, onEscolherMunicipio }: {
  d: DadosTela & { uf: string };
  /** Nome da região da tela (o <h1>). */
  nomeRegiao: string;
  onEscolherMunicipio: (cd: string) => void;
}) {
  const { cargo, uf, local, munAtual, munsUf } = d;
  const r = d.resultado.data;
  const opcoes = useMemo(() => munsUf.map((m) => ({ cd: m.cd, nome: titulo(m.nome) })), [munsUf]);
  return (
    <div className="cabecalho-tela">
      <div className="trilha-linha">
        <nav className="trilha" aria-label="Navegação">
          <LinkTela para={{}}>Brasil</LinkTela>
          <span aria-hidden="true">/</span>
          {munAtual
            ? <LinkTela para={{ uf }}>{UF_NOMES[uf]}</LinkTela>
            : <span aria-current="page">{UF_NOMES[uf]}</span>}
          {munAtual && (
            <>
              <span aria-hidden="true">/</span>
              {local.zona
                ? <LinkTela para={{ uf, mun: munAtual.cd }}>{titulo(munAtual.nome)}</LinkTela>
                : <span aria-current="page">{titulo(munAtual.nome)}</span>}
            </>
          )}
          {local.zona && <><span aria-hidden="true">/</span><span aria-current="page">Zona {Number(local.zona)}</span></>}
        </nav>
        {munsUf.length > 0 && (
          <SeletorMunicipio
            rotulo={uf === 'zz' ? 'Cidade' : 'Município'}
            municipios={opcoes}
            onEscolher={onEscolherMunicipio}
          />
        )}
      </div>
      <h1 className="titulo-tela">{nomeRegiao}<span className="visualmente-oculto">: {nomeCargo(cargo)}</span></h1>
      <p className="subtitulo-tela">
        {cargoBase(cargo)} · {cargo.turno}º turno
        {!local.mun && munsUf.length > 0 && ` · ${fmt(munsUf.length)} ${uf === 'zz' ? 'cidades' : 'municípios'}`}
        {local.mun && !local.zona && munAtual && munAtual.zonas.length > 1 && ` · ${munAtual.zonas.length} zonas`}
        {r && ` · ${fmt(r.eleitorado.total)} eleitores`}
      </p>
    </div>
  );
}
