import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { Candidato, DetalheCandidato } from '../types';
import { useApi } from '../api';
import { Num } from './Num';
import { SeloSituacao } from './SeloSituacao';
import { corPartido, fmt, fmtPct, fmtReais, frase, semAcento, titulo } from '../util';

interface Props {
  c: Candidato;
  pos: number;
  cargo: string;
  onFechar: () => void;
}

const BENS_INICIAIS = 8;

/** Idade hoje a partir de "dd/mm/aaaa". */
function idade(nascimento: string) {
  const [d, m, a] = nascimento.split('/').map(Number);
  const hoje = new Date();
  let anos = hoje.getFullYear() - a;
  if (hoje.getMonth() + 1 < m || (hoje.getMonth() + 1 === m && hoje.getDate() < d)) anos--;
  return anos;
}

/** Ficha do candidato: o que já veio no resultado + perfil e bens dos Dados Abertos do TSE. */
export function ModalCandidato({ c, pos, cargo, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { data: d, erro } = useApi<DetalheCandidato>(`/api/candidato/${c.sq}`);
  const [todosBens, setTodosBens] = useState(false);
  const cor = corPartido(c.partido);

  useEffect(() => {
    // Sem close() na limpeza: o evento "close" chegaria depois e fecharia de novo (StrictMode).
    if (!ref.current!.open) ref.current!.showModal();
  }, []);

  const linha = (rotulo: string, valor: string | null | undefined) =>
    valor ? <div><dt>{rotulo}</dt><dd>{valor}</dd></div> : null;

  const nascimento = d?.nascimento
    ? `${d.nascimento}${d.munNasc ? ` · ${titulo(d.munNasc)}` : ''}${d.ufNasc ? `/${d.ufNasc}` : ''}`
    : null;
  const bens = d ? (todosBens ? d.bens : d.bens.slice(0, BENS_INICIAIS)) : [];

  return (
    <dialog
      ref={ref}
      className="modal-candidato"
      aria-labelledby="modal-candidato-nome"
      onClose={onFechar}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
    >
      <div className="modal-conteudo">
        <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>

        <header className="modal-topo">
          <Foto src={c.foto} nome={c.nomeUrna} cor={cor} grande />
          <div>
            <div className="muted pequeno">{cargo}{c.votos > 0 && ` · ${pos}º colocado`}</div>
            <h2 id="modal-candidato-nome">{titulo(c.nomeUrna)}</h2>
            <div className="cand-nome">
              <span className="numero">{c.numero}</span>
              <span className="partido" style={{ '--cor': cor } as CSSProperties}>{c.partido}</span>
              <SeloSituacao c={c} />
            </div>
            <div className="modal-votos">
              <strong><Num valor={c.pct} formatar={fmtPct} /></strong>
              <span className="muted"><Num valor={c.votos} formatar={fmt} /> votos</span>
            </div>
          </div>
        </header>

        {c.vices && c.vices.length > 0 && (
          <ul className="modal-vices">
            {c.vices.map((v) => (
              <li key={v.sq}>
                <Foto src={v.foto} nome={v.nome} cor={corPartido(v.partido)} />
                <span>
                  <span className="muted pequeno">{v.tipo === 'v' ? 'Vice' : 'Suplente'}</span>
                  <br />{titulo(v.nome)} <span className="muted">({v.partido})</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {erro && !d && <p className="muted">Não foi possível carregar o perfil do candidato ({erro}).</p>}
        {!d && !erro && <p className="muted">Carregando perfil…</p>}

        {d && (
          <>
            <section>
              <h3>Identificação</h3>
              <dl className="modal-dados">
                {linha('Nome completo', titulo(c.nome))}
                {linha('Nome social', d.nomeSocial && titulo(d.nomeSocial))}
                {linha('Idade', d.nascimento && `${idade(d.nascimento)} anos`)}
                {linha('Nascimento', nascimento)}
                {linha('Nacionalidade', d.nacionalidade && frase(d.nacionalidade))}
              </dl>
            </section>

            <section>
              <h3>Perfil</h3>
              <dl className="modal-dados">
                {linha('Gênero', d.genero && frase(d.genero))}
                {linha('Cor/raça', d.corRaca && frase(d.corRaca))}
                {linha('Etnia indígena', d.etniaIndigena && frase(d.etniaIndigena))}
                {linha('Quilombola', d.quilombola ? 'Sim' : null)}
                {linha('Instrução', d.instrucao && frase(d.instrucao))}
                {linha('Estado civil', d.estadoCivil && frase(d.estadoCivil))}
                {linha('Ocupação', d.ocupacao && frase(d.ocupacao))}
              </dl>
            </section>

            <section>
              <h3>Candidatura</h3>
              <dl className="modal-dados">
                {linha('Partido', d.partidoNome && (semAcento(d.partidoNome) === semAcento(c.partido) ? titulo(d.partidoNome) : `${titulo(d.partidoNome)} (${c.partido})`))}
                {linha('Federação', d.federacao && `${titulo(d.federacao)}${d.composicaoFederacao ? ` (${d.composicaoFederacao})` : ''}`)}
                {linha('Coligação', d.coligacao && `${titulo(d.coligacao)}${d.composicaoColigacao ? ` (${d.composicaoColigacao})` : ''}`)}
                {linha('Situação do registro', d.situacaoCandidatura && frase(d.situacaoCandidatura))}
                {linha('Limite de gastos', d.tetoGastos != null ? fmtReais(d.tetoGastos) : null)}
              </dl>
            </section>

            <section>
              <h3>Bens declarados</h3>
              {d.bens.length === 0 ? (
                <p className="muted">Nenhum bem declarado.</p>
              ) : (
                <>
                  <p className="modal-total-bens">
                    <strong>{fmtReais(d.totalBens)}</strong>{' '}
                    <span className="muted">em {fmt(d.bens.length)} {d.bens.length === 1 ? 'bem' : 'bens'}</span>
                  </p>
                  <table className="modal-bens">
                    <thead><tr><th>Bem</th><th>Valor</th></tr></thead>
                    <tbody>
                      {bens.map(([tipo, descricao, valor], i) => (
                        <tr key={i}>
                          <td>
                            {descricao && <span className="bem-descricao">{descricao}</span>}
                            {tipo && <span className="muted pequeno">{tipo}</span>}
                          </td>
                          <td>{fmtReais(valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {d.bens.length > BENS_INICIAIS && (
                    <button className="mais" onClick={() => setTodosBens((t) => !t)}>
                      {todosBens ? 'Mostrar menos' : `Ver todos os ${fmt(d.bens.length)} bens`}
                    </button>
                  )}
                </>
              )}
            </section>

            <p className="muted pequeno modal-fonte">
              Fonte: TSE — resultados e Portal de Dados Abertos (candidatos e bens, gerado em {d.gerado}).
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}

function Foto({ src, nome, cor, grande }: { src: string; nome: string; cor: string; grande?: boolean }) {
  const [semFoto, setSemFoto] = useState(false);
  const classe = `foto ${grande ? 'foto-grande' : ''}`;
  return semFoto
    ? <span className={`${classe} foto-vazia`} style={{ background: cor }}>{nome.charAt(0)}</span>
    : <img className={classe} src={src} alt="" onError={() => setSemFoto(true)} />;
}
