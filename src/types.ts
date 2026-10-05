export interface Cargo {
  id: string; // `${eleicao}-${cargo}`, ex.: "6257-1"
  eleicao: string;
  cargo: string;
  nome: string;
  turno: number;
  data: string;
  /** Início/fim da votação (ISO, horário de Brasília); null no modo demo. */
  abertura: string | null;
  encerramento: string | null;
  /** 100% das seções totalizadas: sem "ao vivo" nem atualização periódica (só ao carregar/navegar). */
  encerrada: boolean;
  tipo: 'majoritario' | 'proporcional';
  escopo: 'br' | 'uf';
  ufs: string[];
}

export interface Config {
  ciclo: string;
  demo: boolean;
  cargos: Cargo[];
}

export interface Municipio {
  cd: string; // código TSE
  ibge: string | null; // código IBGE (liga com a malha do mapa)
  nome: string;
  capital: boolean;
  zonas: string[];
}

export type Municipios = Record<string, { nome: string; municipios: Municipio[] }>;

export interface Candidato {
  numero: string;
  sq: string;
  nome: string;
  nomeUrna: string;
  partido: string;
  coligacao: string | null;
  votos: number;
  pct: number;
  /** Classificado no servidor a partir do texto do TSE; null = ainda indefinido. */
  status: 'eleito' | 'segundo-turno' | 'suplente' | 'nao-eleito' | 'outro' | null;
  /** "por QP" / "por média" (eleitos no proporcional) ou o texto original quando status = 'outro'. */
  detalhe: string | null;
  /** Texto original do TSE (campo `st`). */
  situacao: string | null;
  /** Destino dos votos (campo `dvt`): "Válido", "Válido (legenda)", "Anulado", "Anulado sub judice". */
  destinoVotos: string | null;
  vices?: { tipo: string; sq: string; nome: string; partido: string; foto: string }[];
  foto: string;
  /**
   * Garantido mesmo que todos os votos ainda não apurados fossem para os rivais (calculado no servidor):
   * a vaga ('eleito') ou, no executivo, a vaga no 2º turno ('segundo-turno').
   */
  matematicamente: 'eleito' | 'segundo-turno' | null;
  /**
   * Proporcional (calculado no servidor): ordem de suplência na chapa (partido ou federação) e efeito
   * puxador. `projecao` = antes da situação oficial do TSE, pelas vagas projetadas para cada chapa.
   */
  chapa: {
    /** 1 = 1º suplente da chapa; null se eleito. */
    suplente: number | null;
    /** Eleito com menos votos que o QE, puxado pelo mais votado da chapa (nome de urna). */
    puxadoPor: string | null;
    /** Quantos eleitos da chapa ficaram abaixo do QE (só no puxador). */
    puxou: number;
    /** Quociente eleitoral usado no cálculo. */
    qe: number;
    projecao: boolean;
  } | null;
}

/** Perfil e bens do candidato (Dados Abertos do TSE, via /api/candidato/:sq). */
export interface DetalheCandidato {
  /** Data/hora de geração dos CSVs pelo TSE. */
  gerado: string;
  nomeSocial: string | null;
  nascimento: string | null; // dd/mm/aaaa
  ufNasc: string | null;
  munNasc: string | null;
  nacionalidade: string | null;
  idadePosse: number | null;
  genero: string | null;
  instrucao: string | null;
  estadoCivil: string | null;
  corRaca: string | null;
  ocupacao: string | null;
  quilombola: boolean;
  etniaIndigena: string | null;
  partidoNome: string | null;
  federacao: string | null;
  composicaoFederacao: string | null;
  coligacao: string | null;
  composicaoColigacao: string | null;
  situacaoCandidatura: string | null;
  tetoGastos: number | null;
  /** [tipo, descrição, valor], do maior para o menor valor. */
  bens: [string | null, string | null, number][];
  totalBens: number;
}

export interface Resultado {
  cargo: { cd: string; nome: string; vagas: number };
  abrangencia: { tipo: string; cd: string };
  atualizado: string | null;
  totalizado: boolean;
  secoes: { total: number; totalizadas: number; pct: number };
  eleitorado: {
    total: number;
    comparecimento: number;
    pctComparecimento: number;
    abstencao: number;
    pctAbstencao: number;
  };
  votos: {
    total: number;
    validos: number;
    pctValidos: number;
    brancos: number;
    pctBrancos: number;
    nulos: number;
    pctNulos: number;
  };
  candidatos: Candidato[];
}

export interface Resumo {
  pctApurado: number;
  lider: { numero: string; nome: string; partido: string; pct: number; votos: number } | null;
}

export type MapaDados = Record<string, Resumo | null>;

export interface ItemBusca extends Candidato {
  cargoId: string;
  cargoNome: string;
  uf: string;
  pctApurado: number;
}

/** Onde o usuário está no funil Brasil → UF → município → zona. */
export interface Local {
  uf?: string;
  mun?: string;
  zona?: string;
}

export type ModoMapa = 'lider' | 'apurado';

/** Cadeiras por partido numa casa legislativa (/api/composicao). */
export interface Composicao {
  /** 'br' (Senado, Câmara) ou a UF (bancada federal da UF, assembleia). */
  abrangencia: string;
  vagas: number;
  /** Cadeiras com eleito definido (oficial ou projetado); o resto aparece como "a definir". */
  atribuidas: number;
  /** Antes da situação oficial do TSE: eleitos projetados pelas vagas de cada chapa / mais votados. */
  projecao: boolean;
  pctApurado: number;
  /** UFs cujo resultado ainda não chegou do TSE (as vagas delas ficam de fora). */
  faltando: number;
  partidos: { sigla: string; cadeiras: number }[];
}
