export declare const SLUG_CARGO: Record<string, string>;
export declare function slugTexto(s: string): string;
export declare function slugCargo(c: { cargo: string | number; turno: number }): string;
export declare function cargoPorSlug<C extends { cargo: string | number; turno: number }>(cargos: C[], slug: string): C | undefined;
export declare function caminho(r: { cargo?: string; uf?: string; mun?: string; munNome?: string; zona?: string }): string;
export declare function caminhoCandidato(sq: string, nome?: string): string;
export type RotaLida =
  | { cargo?: string; uf?: string; mun?: string; zona?: string; candidato?: undefined }
  | { candidato: string };
export declare function lerCaminho(pathname: string): RotaLida | null;
export declare function tituloPagina(p: {
  cargoNome?: string; ufNome?: string; uf?: string; munNome?: string; zona?: string; candidato?: string; partido?: string;
}): string;
