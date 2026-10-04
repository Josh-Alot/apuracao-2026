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
  vices?: { tipo: string; nome: string; partido: string }[];
  foto: string;
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
