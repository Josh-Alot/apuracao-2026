// Rotas públicas (caminho da URL), compartilhadas entre o front (App.tsx) e o servidor (meta tags, sitemap, 404).
// JavaScript puro para o Node importar sem build; os tipos estão em rotas.d.mts.
//
//   /                                           cargo padrão (o 1º da config), Brasil
//   /<cargo>                                    ex. /governador, /presidente-2-turno
//   /<cargo>/<uf>                               ex. /governador/sp
//   /<cargo>/<uf>/<mun>[-<nome>]                ex. /governador/sp/71072-sao-paulo (código TSE; o nome é opcional)
//   /<cargo>/<uf>/<mun>[-<nome>]/zona-<zona>    ex. /governador/sp/71072-sao-paulo/zona-0001
//   /candidato/<sq>[-<nome>]                    ficha do candidato, ex. /candidato/250002345678-fulano-de-tal

export const SLUG_CARGO = {
  1: 'presidente', 3: 'governador', 5: 'senador',
  6: 'deputado-federal', 7: 'deputado-estadual', 8: 'deputado-distrital',
};

/** "São Paulo d'Oeste" → "sao-paulo-d-oeste" */
export function slugTexto(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Slug de um cargo da config (`cargo` = código TSE do cargo, `turno` = 1 | 2). */
export function slugCargo({ cargo, turno }) {
  const base = SLUG_CARGO[cargo] ?? `cargo-${cargo}`;
  return turno === 2 ? `${base}-2-turno` : base;
}

/** Cargo da config pelo slug da URL. */
export function cargoPorSlug(cargos, slug) {
  return cargos.find((c) => slugCargo(c) === slug);
}

/** Monta o caminho; `munNome` entra no slug quando conhecido. */
export function caminho({ cargo, uf, mun, munNome, zona }) {
  if (!cargo) return '/';
  let p = `/${cargo}`;
  if (uf) {
    p += `/${uf}`;
    if (mun) {
      p += `/${mun}${munNome ? `-${slugTexto(munNome)}` : ''}`;
      if (zona) p += `/zona-${zona}`;
    }
  }
  return p;
}

export function caminhoCandidato(sq, nome) {
  return `/candidato/${sq}${nome ? `-${slugTexto(nome)}` : ''}`;
}

/**
 * Lê o caminho. Devolve `{ cargo?, uf?, mun?, zona? }` (cargo = slug), `{ candidato: sq }`
 * ou `null` se o formato não é de nenhuma rota (o servidor responde 404; validar cargo/UF/município existentes
 * fica com quem chama).
 */
export function lerCaminho(pathname) {
  const partes = pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (partes.length === 0) return {};
  if (partes[0] === 'candidato') {
    const m = partes.length === 2 && /^(\d+)(?:-[a-z0-9-]*)?$/.exec(partes[1]);
    return m ? { candidato: m[1] } : null;
  }
  const [cargo, uf, mun, zona] = partes;
  if (partes.length > 4 || !/^[a-z0-9-]+$/.test(cargo)) return null;
  const r = { cargo };
  if (uf !== undefined) {
    if (!/^[a-z]{2}$/.test(uf)) return null;
    r.uf = uf;
  }
  if (mun !== undefined) {
    const m = /^(\d+)(?:-[a-z0-9-]*)?$/.exec(mun);
    if (!m) return null;
    r.mun = m[1];
  }
  if (zona !== undefined) {
    const m = /^zona-(\d+)$/.exec(zona);
    if (!m) return null;
    r.zona = m[1];
  }
  return r;
}

/**
 * Título da página (≈60 caracteres), igual no servidor (<title> inicial) e no front (document.title).
 * `cargoNome` já com o turno quando for o 2º (ex. "Governador 2º turno"); nomes já resolvidos por quem chama.
 */
export function tituloPagina({ cargoNome, ufNome, uf, munNome, zona, candidato, partido }) {
  if (candidato) return `${candidato}${partido ? ` (${partido})` : ''}: votos, perfil e bens em 2026`;
  if (!cargoNome) return 'Apuração 2026: resultados das eleições ao vivo';
  const exterior = uf === 'zz'; // cidades no exterior: "(exterior)" no lugar da sigla, "no exterior" no lugar da UF
  const sigla = exterior ? 'exterior' : uf?.toUpperCase();
  if (munNome && zona) return `${cargoNome} em ${munNome} (${sigla}), zona ${Number(zona)}: resultado 2026`;
  if (munNome) return `${cargoNome} em ${munNome} (${sigla}): resultado 2026`;
  if (exterior) return `${cargoNome} no exterior 2026: resultado da apuração`;
  if (ufNome) return `${cargoNome} ${ufNome} 2026: resultado da apuração`;
  return `${cargoNome} 2026: resultado da apuração no Brasil`;
}
