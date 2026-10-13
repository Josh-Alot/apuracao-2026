import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { Candidato, DetalheCandidato } from '../types';
import { useApi } from '../api';
import { useCores } from '../tema';
import { caminhoCandidato } from '../rotas.mjs';
import { Num } from './Num';
import { SeloSituacao } from './SeloSituacao';
import { corPartido, fmt, fmtPct, fmtReais, frase, semAcento, titulo } from '../util';

interface Props {
  c: Candidato;
  pos: number;
  cargo: string;
  /** Onde: "Brasil", "São Paulo"… */
  local: string;
  /** "15 UFs" vencidas, quando o mapa sabe. */
  vencidas?: string | null;
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

/** Texto da situação na linha do número/partido ("vai ao 2º turno"), ou null. */
function situacao(c: Candidato) {
  if (c.status === 'eleito') return `Eleito${c.detalhe ? ` ${c.detalhe}` : ''}`;
  if (c.status === 'segundo-turno') return 'Vai ao 2º turno';
  if (c.matematicamente === 'eleito') return 'Matematicamente eleito';
  if (c.matematicamente === 'segundo-turno') return '2º turno garantido';
  return null;
}

/** Ficha do candidato: o que já veio no resultado + perfil e bens dos Dados Abertos do TSE. */
export function ModalCandidato({ c, pos, cargo, local, vencidas, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { data: d, erro } = useApi<DetalheCandidato>(`/api/candidato/${c.sq}`);
  const [todosBens, setTodosBens] = useState(false);
  const tema = useCores();
  const cor = corPartido(c.partido);

  // Quem abriu a ficha (link da tabela, nome no placar) volta a ter o foco quando ela fecha. Lido no 1º render,
  // antes do showModal (que move o foco para dentro da ficha).
  const [origem] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    // Sem close() na limpeza: o evento "close" chegaria depois e fecharia de novo (StrictMode).
    if (!ref.current!.open) ref.current!.showModal();
    return () => { if (origem?.isConnected) origem.focus({ preventScroll: true }); };
  }, []);

  const linha = (rotulo: string, valor: string | null | undefined) =>
    valor ? <div><dt>{rotulo}</dt><dd>{valor}</dd></div> : null;

  const nascimento = d?.nascimento
    ? `${d.nascimento}${d.munNasc ? ` · ${titulo(d.munNasc)}` : ''}${d.ufNasc ? `/${d.ufNasc}` : ''}`
    : null;
  const bens = d ? (todosBens ? d.bens : d.bens.slice(0, BENS_INICIAIS)) : [];
  const sit = situacao(c);
  // Os demais selos (suplência, puxador, votos anulados) seguem embaixo, como na tabela.
  const outrosSelos = c.status === 'suplente' || c.status === 'nao-eleito' || c.status === 'outro' || !!c.chapa
    || (!!c.destinoVotos && c.destinoVotos !== 'Válido');

  return (
    <dialog
      ref={ref}
      className="modal-candidato"
      aria-labelledby="modal-candidato-nome"
      style={{ '--cor': tema.preench(cor) } as CSSProperties}
      onClose={onFechar}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
    >
      <div className="modal-conteudo">
        <header className="modal-topo">
          {/* Foto principal da página do candidato (/candidato/<sq>): com alt, também para a busca de imagens. */}
          <Foto src={c.foto} nome={c.nomeUrna} cor={cor} alt={`Foto de ${titulo(c.nomeUrna)}`} grande />
          <div className="modal-identidade">
            <div className="rotulo-secao muted">
              {cargo} · {local}{c.votos > 0 && ` · ${pos}º colocado`}
            </div>
            <h2 id="modal-candidato-nome">{titulo(c.nomeUrna)}</h2>
            <div className="modal-linha-partido">
              <span>{c.numero}</span>
              <span className="partido-borda" style={{ borderColor: tema.preench(cor), color: tema.texto(cor) }}>{c.partido}</span>
              {sit && <span>{sit}</span>}
            </div>
            {outrosSelos && <div className="selos"><SeloSituacao c={{ ...c, status: c.status === 'eleito' || c.status === 'segundo-turno' ? null : c.status, matematicamente: null }} /></div>}
            <div className="modal-votos">
              <strong><Num valor={c.pct} formatar={fmtPct} /></strong>
              <span className="muted"><Num valor={c.votos} formatar={fmt} /> votos{vencidas && ` · ${vencidas}`}</span>
            </div>
          </div>
          <button className="botao-icone modal-fechar" onClick={onFechar} aria-label="Fechar">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        </header>

        {c.vices && c.vices.length > 0 && (
          <ul className="modal-vices">
            {c.vices.map((v) => (
              <li key={v.sq}>
                <Foto src={v.foto} nome={v.nome} cor={corPartido(v.partido)} />
                <span>
                  <span className="rotulo-secao muted">{v.tipo === 'v' ? 'Vice' : 'Suplente'}</span>
                  <br />{titulo(v.nome)} <span className="muted">({v.partido})</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {erro && !d && <p className="muted">Não foi possível carregar o perfil do candidato ({erro}).</p>}
        {!d && !erro && <p className="muted">Carregando perfil…</p>}

        {d && (
          <div className="modal-corpo">
            <div className="modal-coluna">
              <section>
                <h3 className="rotulo-secao">Identificação</h3>
                <dl className="modal-dados">
                  {linha('Nome completo', titulo(c.nome))}
                  {linha('Nome social', d.nomeSocial && titulo(d.nomeSocial))}
                  {linha('Idade', d.nascimento && `${idade(d.nascimento)} anos`)}
                  {linha('Nascimento', nascimento)}
                  {linha('Nacionalidade', d.nacionalidade && frase(d.nacionalidade))}
                </dl>
              </section>

              <section>
                <h3 className="rotulo-secao">Perfil</h3>
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
                <h3 className="rotulo-secao">Candidatura</h3>
                <dl className="modal-dados">
                  {linha('Partido', d.partidoNome && (semAcento(d.partidoNome) === semAcento(c.partido) ? titulo(d.partidoNome) : `${titulo(d.partidoNome)} (${c.partido})`))}
                  {linha('Federação', d.federacao && `${titulo(d.federacao)}${d.composicaoFederacao ? ` (${d.composicaoFederacao})` : ''}`)}
                  {linha('Coligação', d.coligacao && `${titulo(d.coligacao)}${d.composicaoColigacao ? ` (${d.composicaoColigacao})` : ''}`)}
                  {linha('Situação do registro', d.situacaoCandidatura && frase(d.situacaoCandidatura))}
                  {linha('Limite de gastos', d.tetoGastos != null ? fmtReais(d.tetoGastos) : null)}
                </dl>
              </section>
            </div>

            <section className="modal-coluna">
              <h3 className="rotulo-secao">Bens declarados</h3>
              {d.bens.length === 0 ? (
                <p className="muted">Nenhum bem declarado.</p>
              ) : (
                <>
                  <p className="modal-total-bens">
                    <strong>{fmtReais(d.totalBens)}</strong>
                    <span className="muted">em {fmt(d.bens.length)} {d.bens.length === 1 ? 'bem' : 'bens'}</span>
                  </p>
                  <table className="modal-bens">
                    <thead><tr><th>Bem</th><th>Valor</th></tr></thead>
                    <tbody>
                      {bens.map(([tipo, descricao, valor], i) => (
                        <tr key={i}>
                          <td>
                            {descricao && <span className="bem-descricao">{descricao}</span>}
                            {tipo && <span className="muted bem-tipo">{tipo}</span>}
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
          </div>
        )}

        <footer className="modal-fonte muted">
          <span>
            Perfil e bens: Dados Abertos do TSE{d && ` · atualizado em ${d.gerado}`}
          </span>
          <span>{caminhoCandidato(c.sq, c.nomeUrna)}</span>
        </footer>
      </div>
    </dialog>
  );
}

/** `alt` vazio por padrão: nos vices o nome está logo ao lado, em texto. */
function Foto({ src, nome, cor, alt = '', grande }: { src: string; nome: string; cor: string; alt?: string; grande?: boolean }) {
  const [semFoto, setSemFoto] = useState(false);
  const classe = `foto ${grande ? 'foto-grande' : ''}`;
  return semFoto
    ? <span className={`${classe} foto-vazia`} style={{ background: cor }}>{nome.charAt(0)}</span>
    : <img className={classe} src={src} alt={alt} onError={() => setSemFoto(true)} />;
}
