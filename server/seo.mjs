// SEO: HTML por rota (título, descrição, canonical, Open Graph, JSON-LD e um resumo em texto dentro do #root, que o
// React substitui ao montar), 404 de verdade para rota inexistente, robots.txt e sitemaps.
//
// Custo: o Googlebot pede dezenas de milhares de URLs, então nada aqui consulta o TSE. Entram só a configuração
// (já lida em todo pedido), os municípios (do 1º turno, que está no arquivo próprio), o perfil dos candidatos e
// resultados que já estão no cache em memória ou no arquivo próprio final (`getResultadoSemTse`) — e esses com
// prazo (`PRAZO_MS`): passou disso, a descrição sai genérica.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { getConfig, getMunicipios, getResultadoSemTse, resultadoUrl, CICLO, TSE_BASE } from './tse.mjs';
import { getCandidato, geradoEm } from './candidatos.mjs';
import { dataFinal, eleicaoFinal } from './arquivo.mjs';
import { cargoVisivel, flagsDe } from './flags.mjs';
import { slugCargo, cargoPorSlug, caminho, caminhoCandidato, lerCaminho, tituloPagina } from '../src/rotas.mjs';

const NOME_SITE = 'Apuração 2026';
const PRAZO_MS = 300;

// ---------- endereço público ----------

// SITE_URL (ex. https://apuracao2026.com.br): base do canonical, og:url e sitemap. Com ela definida, pedido que chega
// por outro host (o *.onrender.com) recebe 301 para o mesmo caminho nela — menos /api/*, para não quebrar o SSE,
// o health check do Render e quem já está com a página aberta.
const SITE_URL = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
const SITE_HOST = SITE_URL ? new URL(SITE_URL).host.toLowerCase() : '';

/** Base absoluta do site: SITE_URL ou, sem ela, o que o proxy do Render informa. */
export function baseDe(req) {
  if (SITE_URL) return SITE_URL;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  const host = String(req.headers.host || '');
  return `${proto}://${/^[a-z0-9.:[\]-]+$/i.test(host) ? host.toLowerCase() : 'localhost'}`;
}

/** 301 para o SITE_URL quando o pedido veio por outro host. Devolve true se respondeu. */
export function redirecionarHost(req, res, url) {
  if (!SITE_HOST || url.pathname.startsWith('/api/')) return false;
  if (String(req.headers.host || '').toLowerCase() === SITE_HOST) return false;
  res.writeHead(301, { location: `${SITE_URL}${url.pathname}${url.search}` });
  res.end();
  return true;
}

// ---------- texto ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const nf = new Intl.NumberFormat('pt-BR');
const pf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const rf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (n) => `${pf.format(n)}%`;

/** "SÃO JOSÉ DOS CAMPOS" → "São José dos Campos" (igual ao `titulo` de src/util.ts, para bater com o front). */
function titulo(s) {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', "d'"]);
  return String(s).toLowerCase().split(' ')
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
}

// Preposição + artigo antes do nome da UF: "no Rio de Janeiro", "na Bahia", "em São Paulo".
const UF_O = new Set(['ac', 'ap', 'am', 'ce', 'df', 'es', 'ma', 'mt', 'ms', 'pa', 'pr', 'pi', 'rj', 'rn', 'rs', 'to', 'zz']);
const UF_A = new Set(['ba', 'pb']);
const PREP = { em: ['no', 'na', 'em'], de: ['do', 'da', 'de'], por: ['pelo', 'pela', 'por'] };
const naUf = (prep, uf, nome) => `${PREP[prep][UF_O.has(uf) ? 0 : UF_A.has(uf) ? 1 : 2]} ${nome}`;

/** Corta no limite de caracteres sem partir palavra. */
function limitar(s, max = 160) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[,;:]$/, '')}…`;
}

/** Junta o resumo dos votos e o complemento genérico, largando o complemento se passar de ~160 caracteres. */
const descricao = (votos, complemento) => (votos ? limitar(`${votos} ${complemento}`.length <= 160 ? `${votos} ${complemento}` : votos) : limitar(complemento));

const cargoBase = (c) => c.nome.replace(/\s*\(2º turno\)$/, '');
/** Nome do cargo para `tituloPagina` (com o turno quando for o 2º). */
const cargoNome = (c) => `${cargoBase(c)}${c.turno === 2 ? ' 2º turno' : ''}`;
const noTurno = (c) => (c.turno === 2 ? ' no 2º turno' : '');

// ---------- dados baratos ----------

/** Promessa com prazo: passou de `ms` (ou falhou), null. */
const comPrazo = (p, ms = PRAZO_MS) => Promise.race([
  Promise.resolve(p).catch(() => null),
  new Promise((r) => setTimeout(r, ms, null)),
]);

// Municípios por eleição (lista do TSE já normalizada). O 2º turno usa a do 1º: os municípios e zonas são os
// mesmos e a do 1º turno sai do arquivo próprio, sem consultar o TSE.
const municipiosMemo = new Map(); // eleição → { ts, p }
async function municipiosDe(c, cfg) {
  const e = (c.primeiroTurno && cfg.cargos.find((x) => x.id === c.primeiroTurno)?.eleicao) || c.eleicao;
  const hit = municipiosMemo.get(e);
  if (hit && Date.now() - hit.ts < 30 * 60_000) return hit.p;
  const p = getMunicipios(e).then((m) => {
    if (!m) throw new Error(`sem lista de municípios da eleição ${e}`);
    return m;
  });
  p.catch(() => municipiosMemo.delete(e));
  municipiosMemo.set(e, { ts: Date.now(), p });
  return p;
}

const cargoFinal = (c) => eleicaoFinal(resultadoUrl({ eleicao: c.eleicao, cargo: c.cargo, uf: 'br' }), TSE_BASE);

// Índice dos candidatos (nome de urna, partido, cargo, UF, votos) montado das eleições finais do arquivo próprio:
// o perfil (dados/candidatos-2026.tsv.gz) não traz nome nem cargo. Lê os ~140 arquivos de UF uma vez só e
// remonta apenas quando muda o conjunto de eleições finais.
let indice = { chave: null, p: null };
async function indiceCandidatos() {
  const cfg = await getConfig();
  const finais = cfg.cargos.filter(cargoFinal);
  const chave = finais.map((c) => c.id).join();
  if (indice.chave === chave) return indice.p;
  const p = (async () => {
    const mapa = new Map(); // sq → [entrada]
    for (const c of finais) {
      for (const uf of c.escopo === 'br' ? ['br'] : c.ufs) {
        const r = await getResultadoSemTse({ eleicao: c.eleicao, cargo: c.cargo, uf });
        for (const cand of r?.candidatos ?? []) {
          const e = {
            cargoId: c.id, turno: c.turno, uf: uf === 'br' ? null : uf, nome: cand.nome, nomeUrna: cand.nomeUrna,
            partido: cand.partido, numero: cand.numero, votos: cand.votos, pct: cand.pct, status: cand.status,
            foto: cand.foto, apurado: r.secoes.pct,
          };
          const lista = mapa.get(cand.sq);
          if (lista) lista.push(e);
          else mapa.set(cand.sq, [e]);
        }
      }
    }
    return mapa;
  })();
  p.catch(() => { if (indice.p === p) indice = { chave: null, p: null }; });
  indice = { chave, p };
  return p;
}

/** Entrada do candidato no cargo visível mais recente (2º turno antes do 1º). */
async function entradaCandidato(sq, cargos) {
  const lista = (await indiceCandidatos()).get(sq) ?? [];
  const visiveis = new Set(cargos.map((c) => c.id));
  return lista.filter((e) => visiveis.has(e.cargoId)).sort((a, b) => b.turno - a.turno)[0] ?? null;
}

/** Cargo/UF da candidatura visível mais recente, para o front abrir a ficha sobre a tela certa (`/api/candidato`). */
export async function candidaturaDe(sq, flags) {
  const cargos = (await getConfig()).cargos.filter((c) => cargoVisivel(c, flags));
  const e = await entradaCandidato(sq, cargos);
  return e ? { cargoId: e.cargoId, uf: e.uf } : null;
}

/** "Fulano (PT) 45,2% e Beltrano (PL) 40,1%" a partir de um resultado normalizado, ou null sem votos. */
function frente(r) {
  if (!r || !(r.secoes.pct > 0)) return null;
  const top = r.candidatos.filter((c) => c.votos > 0).slice(0, 2);
  if (!top.length) return null;
  const nomes = top.map((c) => `${titulo(c.nomeUrna)} (${c.partido}) ${pct(c.pct)}`).join(' e ');
  return { texto: nomes, apurado: pct(r.secoes.pct), top };
}

// ---------- montagem das páginas ----------

const NAO_ENCONTRADA = {
  status: 404,
  titulo: `Página não encontrada | ${NOME_SITE}`,
  descricao: 'Esta página não existe. Veja a apuração das Eleições 2026 com dados oficiais do TSE.',
  h1: 'Página não encontrada',
  texto: 'O endereço não corresponde a nenhum cargo, estado, município, zona ou candidato das Eleições 2026.',
  listas: [{ titulo: 'Continue por aqui', itens: [{ nome: 'Início da apuração', caminho: '/' }] }],
};

/**
 * Página da rota: { status, titulo, descricao, caminho (canonical), h1, texto, migalhas, listas, ld }.
 * `flags` são as do pedido (com prévia, o 2º turno escondido aparece).
 */
async function montarPagina(pathname, flags) {
  let rota = null;
  try { rota = lerCaminho(pathname); } catch { /* %-escape inválido */ }
  if (!rota) return NAO_ENCONTRADA;
  const cfg = await getConfig();
  const cargos = cfg.cargos.filter((c) => cargoVisivel(c, flags));
  if (rota.candidato) return paginaCandidato(rota.candidato, cargos, cfg);
  if (!rota.cargo) return paginaInicio(cargos);

  const c = cargoPorSlug(cargos, rota.cargo);
  if (!c || (rota.uf && !c.ufs.includes(rota.uf))) return NAO_ENCONTRADA;
  const slug = slugCargo(c);
  const muns = await municipiosDe(c, cfg);
  const nomeUf = (u) => titulo(muns[u]?.nome ?? u.toUpperCase());
  const lista = rota.uf ? muns[rota.uf]?.municipios ?? [] : [];
  const m = rota.mun ? lista.find((x) => x.cd === rota.mun) : null;
  if (rota.mun && !m) return NAO_ENCONTRADA;
  const zona = rota.zona ? m.zonas.find((z) => Number(z) === Number(rota.zona)) : null;
  if (rota.zona && !zona) return NAO_ENCONTRADA;

  const { uf } = rota;
  const ufNome = uf && nomeUf(uf);
  const munNome = m && titulo(m.nome);
  const migalhas = [{ nome: 'Brasil', caminho: `/${slug}` }];
  if (uf) migalhas.push({ nome: ufNome, caminho: caminho({ cargo: slug, uf }) });
  if (m) migalhas.push({ nome: munNome, caminho: caminho({ cargo: slug, uf, mun: m.cd, munNome: m.nome }) });
  if (zona) migalhas.push({ nome: `Zona ${Number(zona)}`, caminho: caminho({ cargo: slug, uf, mun: m.cd, munNome: m.nome, zona }) });

  // Resultado só onde há um arquivo dessa abrangência e sem consultar o TSE; no proporcional, abaixo da UF o
  // arquivo próprio teria de abrir a unidade inteira da UF (vários MB): só se já estiver no cache.
  const params = uf ? { eleicao: c.eleicao, cargo: c.cargo, uf, mun: m?.cd, zona: zona ?? undefined }
    : c.escopo === 'br' ? { eleicao: c.eleicao, cargo: c.cargo, uf: 'br' } : null;
  const r = params && await comPrazo(getResultadoSemTse(params, { arquivo: !m || c.tipo !== 'proporcional' }));
  const f = frente(r);

  const cargoTxt = cargoBase(c).toLowerCase();
  const lugar = zona ? `na zona eleitoral ${Number(zona)} de ${munNome} (${uf.toUpperCase()})`
    : m ? `em ${munNome} (${uf.toUpperCase()})` : uf ? naUf('em', uf, ufNome) : 'no Brasil';
  const proporcional = c.tipo === 'proporcional';
  const votos = f && `${cargoBase(c)}${c.turno === 2 ? ' (2º turno)' : ''} ${lugar}, 2026: ${proporcional ? 'mais votados ' : ''}${f.texto}${proporcional ? '' : ' dos válidos'}, com ${f.apurado} das seções apuradas.`;
  const detalhe = zona ? 'votos por candidato na zona' : m ? 'votos por candidato e por zona eleitoral'
    : uf ? 'votos por candidato e mapa por município' : 'mapa por estado e município';
  const complemento = votos ? `${detalhe[0].toUpperCase()}${detalhe.slice(1)}, dados do TSE.`
    : `Resultado ${c.turno === 2 ? 'do 2º turno ' : ''}da eleição para ${cargoTxt} ${lugar} em 2026: ${detalhe}, com dados oficiais do TSE.`;

  const listas = [];
  if (f) {
    listas.push({
      titulo: proporcional ? 'Mais votados' : 'À frente',
      itens: f.top.map((x) => ({ nome: `${titulo(x.nomeUrna)} (${x.partido}), ${pct(x.pct)}`, caminho: caminhoCandidato(x.sq, x.nomeUrna) })),
    });
  }
  if (!uf) {
    listas.push({ titulo: 'Resultado por estado', itens: c.ufs.map((u) => ({ nome: nomeUf(u), caminho: caminho({ cargo: slug, uf: u }) })) });
  } else if (!m) {
    listas.push({ titulo: uf === 'zz' ? 'Resultado por cidade' : 'Resultado por município', itens: lista.map((x) => ({ nome: titulo(x.nome), caminho: caminho({ cargo: slug, uf, mun: x.cd, munNome: x.nome }) })) });
  } else if (!zona) {
    listas.push({ titulo: 'Resultado por zona eleitoral', itens: [...m.zonas].sort((a, b) => a - b).map((z) => ({ nome: `Zona ${Number(z)}`, caminho: caminho({ cargo: slug, uf, mun: m.cd, munNome: m.nome, zona: z }) })) });
  }
  const acima = migalhas.length > 1 ? migalhas.at(-2) : { nome: 'Início', caminho: '/' };
  listas.push({ titulo: 'Veja também', itens: [{ nome: acima.nome === 'Brasil' ? `${cargoBase(c)} no Brasil` : acima.nome, caminho: acima.caminho }] });

  const titulo_ = tituloPagina({ cargoNome: cargoNome(c), ufNome, uf, munNome, zona: zona ?? undefined });
  return {
    status: 200,
    titulo: titulo_,
    descricao: descricao(votos, complemento),
    caminho: migalhas.at(-1).caminho,
    h1: titulo_,
    texto: descricao(votos, complemento),
    migalhas: migalhas.length > 1 ? migalhas : null,
    listas,
  };
}

function paginaInicio(cargos) {
  const descricao_ = 'Apuração das Eleições 2026 com dados oficiais do TSE: presidente, governador, senador e deputados, com mapa por estado, município e zona eleitoral.';
  return {
    status: 200,
    titulo: tituloPagina({}),
    descricao: descricao_,
    caminho: '/',
    h1: tituloPagina({}),
    texto: descricao_,
    listas: [{ titulo: 'Cargos', itens: cargos.map((c) => ({ nome: cargoNome(c), caminho: `/${slugCargo(c)}` })) }],
    site: true,
  };
}

async function paginaCandidato(sq, cargos, cfg) {
  // O perfil (ou o índice) prova que o candidato existe; o índice dá nome, cargo e votos. Sem prazo: o índice é
  // trabalho local (~1 s, uma vez por processo) e sem ele o canonical sairia sem o nome.
  const [perfil, entrada] = await Promise.all([
    getCandidato(sq).catch(() => null),
    entradaCandidato(sq, cargos).catch(() => null),
  ]);
  if (!perfil && !entrada) return NAO_ENCONTRADA;

  const c = entrada && cfg.cargos.find((x) => x.id === entrada.cargoId);
  const nome = entrada ? titulo(entrada.nomeUrna) : perfil.nomeSocial ? titulo(perfil.nomeSocial) : `Candidatura ${sq}`;
  const feminino = perfil?.genero === 'FEMININO';
  const migalhas = [];
  let sobre = 'nas Eleições 2026';
  let situacao = '';
  if (c) {
    const slug = slugCargo(c);
    migalhas.push({ nome: 'Brasil', caminho: `/${slug}` });
    let ufNome = null;
    if (entrada.uf) {
      ufNome = titulo((await comPrazo(municipiosDe(c, cfg)))?.[entrada.uf]?.nome ?? entrada.uf.toUpperCase());
      migalhas.push({ nome: ufNome, caminho: caminho({ cargo: slug, uf: entrada.uf }) });
    }
    const cargoTxt = cargoBase(c).toLowerCase();
    const onde = !entrada.uf ? '' : c.tipo === 'proporcional' ? ` ${naUf('por', entrada.uf, ufNome)}` : ` ${naUf('de', entrada.uf, ufNome)}`;
    sobre = `${feminino ? 'candidata ao cargo de' : 'candidato a'} ${cargoTxt}${onde} em 2026${noTurno(c)}`;
    if (entrada.votos > 0) {
      const st = { eleito: feminino ? 'eleita' : 'eleito', 'segundo-turno': 'foi ao 2º turno', suplente: 'suplente', 'nao-eleito': feminino ? 'não eleita' : 'não eleito' }[entrada.status];
      situacao = `: ${nf.format(entrada.votos)} votos (${pct(entrada.pct)})${st && entrada.apurado >= 100 ? `, ${st}` : ''}`;
    }
  }
  const caminho_ = caminhoCandidato(sq, entrada?.nomeUrna);
  migalhas.push({ nome, caminho: caminho_ });
  const partido = entrada?.partido;
  const desc = descricao(
    `${nome}${partido ? ` (${partido})` : ''}, ${sobre}${situacao}.`,
    'Perfil, ocupação, bens declarados e resultado, com dados do TSE.',
  );

  // Fatos do perfil que a ficha mostra (nunca CPF, título ou e-mail, que nem estão no arquivo).
  const fatos = [];
  if (entrada?.nome) fatos.push(['Nome completo', titulo(entrada.nome)]);
  if (perfil?.partidoNome) fatos.push(['Partido', titulo(perfil.partidoNome)]);
  if (entrada?.numero) fatos.push(['Número', entrada.numero]);
  if (perfil?.nascimento) fatos.push(['Nascimento', perfil.nascimento]);
  if (perfil?.ocupacao) fatos.push(['Ocupação', perfil.ocupacao.charAt(0) + perfil.ocupacao.slice(1).toLowerCase()]);
  if (perfil?.totalBens > 0) fatos.push(['Bens declarados', rf.format(perfil.totalBens)]);

  const [d, mes, a] = (perfil?.nascimento ?? '').split('/');
  const pessoa = {
    '@type': 'Person',
    name: nome,
    ...(entrada?.nome && { alternateName: titulo(entrada.nome) }),
    ...(entrada?.foto && { image: entrada.foto }),
    ...(a && { birthDate: `${a}-${mes}-${d}` }),
    ...(perfil?.ocupacao && { jobTitle: fatos.find((x) => x[0] === 'Ocupação')[1] }),
    ...(perfil?.partidoNome && { affiliation: { '@type': 'Organization', name: titulo(perfil.partidoNome) } }),
  };
  return {
    status: 200,
    titulo: tituloPagina({ candidato: nome, partido }),
    descricao: desc,
    caminho: caminho_,
    h1: nome,
    texto: desc,
    fatos,
    migalhas: migalhas.length > 1 ? migalhas : null,
    listas: c ? [{ titulo: 'Veja também', itens: [{ nome: `${cargoNome(c)} ${migalhas.length > 2 ? naUf('em', entrada.uf, migalhas[1].nome) : 'no Brasil'}`, caminho: migalhas.at(-2).caminho }] }] : [],
    pessoa,
  };
}

// ---------- HTML ----------

let modelo = null;
/** dist/index.html, lido uma vez. Marcadores: <title>, <!--seo-->…<!--/seo--> no head e <!--seo:conteudo--> no #root. */
export function lerModelo(arquivo) {
  modelo ??= fs.readFile(arquivo, 'utf8').then((html) => {
    if (!html.includes('<!--seo:conteudo-->') || !html.includes('<!--/seo-->')) console.warn('index.html sem os marcadores de SEO');
    return html;
  }).catch((err) => {
    modelo = null;
    throw err;
  });
  return modelo;
}

function renderizar(html, p, base) {
  const url = `${base}${p.caminho ?? ''}`;
  const imagem = `${base}/og.png`;
  const cab = [`<meta name="description" content="${esc(p.descricao)}" />`];
  if (p.status === 404) {
    cab.push('<meta name="robots" content="noindex" />');
  } else {
    cab.push(
      `<link rel="canonical" href="${esc(url)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${NOME_SITE}" />`,
      `<meta property="og:locale" content="pt_BR" />`,
      `<meta property="og:title" content="${esc(p.titulo)}" />`,
      `<meta property="og:description" content="${esc(p.descricao)}" />`,
      `<meta property="og:url" content="${esc(url)}" />`,
      `<meta property="og:image" content="${esc(imagem)}" />`,
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      `<meta property="og:image:alt" content="${NOME_SITE}: resultados das eleições com dados oficiais do TSE" />`,
      '<meta name="twitter:card" content="summary_large_image" />',
      `<meta name="twitter:title" content="${esc(p.titulo)}" />`,
      `<meta name="twitter:description" content="${esc(p.descricao)}" />`,
      `<meta name="twitter:image" content="${esc(imagem)}" />`,
    );
    // Dados estruturados só do que o resumo abaixo mostra: o site (início), as migalhas e a pessoa (ficha).
    const grafo = [];
    if (p.site) grafo.push({ '@type': 'WebSite', name: NOME_SITE, url: `${base}/`, inLanguage: 'pt-BR', description: p.descricao });
    if (p.migalhas) {
      grafo.push({
        '@type': 'BreadcrumbList',
        itemListElement: p.migalhas.map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m.nome, item: `${base}${m.caminho}` })),
      });
    }
    if (p.pessoa) grafo.push({ ...p.pessoa, url });
    if (grafo.length) cab.push(`<script type="application/ld+json">${jsonLd({ '@context': 'https://schema.org', '@graph': grafo })}</script>`);
  }

  // Resumo em texto para robôs e para quem ainda não carregou o JavaScript; o React troca tudo ao montar.
  const corpo = ['<div class="seo-resumo">'];
  if (p.migalhas) {
    corpo.push(`<nav aria-label="Você está em"><ol>${p.migalhas.map((m, i) => (i === p.migalhas.length - 1
      ? `<li aria-current="page">${esc(m.nome)}</li>` : `<li><a href="${esc(m.caminho)}">${esc(m.nome)}</a></li>`)).join('')}</ol></nav>`);
  }
  corpo.push(`<h1>${esc(p.h1)}</h1>`, `<p>${esc(p.texto)}</p>`);
  if (p.fatos?.length) corpo.push(`<dl>${p.fatos.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);
  for (const l of p.listas ?? []) {
    if (!l.itens.length) continue;
    corpo.push(`<h2>${esc(l.titulo)}</h2><ul>${l.itens.map((x) => `<li><a href="${esc(x.caminho)}">${esc(x.nome)}</a></li>`).join('')}</ul>`);
  }
  corpo.push('</div>');

  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(p.titulo)}</title>`)
    .replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, `<!--seo-->\n    ${cab.join('\n    ')}\n    <!--/seo-->`)
    .replace('<!--seo:conteudo-->', corpo.join('\n'));
}

/** Responde uma rota de página: 200 com o HTML preenchido ou 404 (mesmo app, com noindex). */
export async function responderPagina(req, res, pathname, arquivoModelo) {
  const html = await lerModelo(arquivoModelo);
  let p;
  try {
    p = await montarPagina(pathname === '/index.html' ? '/' : pathname, flagsDe(req));
  } catch (err) {
    // Sem como validar (configuração ou municípios indisponíveis): o app abre normalmente, sem meta por rota.
    console.warn(`SEO: página genérica para ${pathname}: ${err.message}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(html);
  }
  res.writeHead(p.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(renderizar(html, p, baseDe(req)));
}

// ---------- robots.txt e sitemaps ----------

// O Google renderiza o app: sem config/resultado/candidato ele indexaria só o esqueleto (o createRoot apaga o
// resumo do servidor). Ficam liberadas as rotas baratas (cache e arquivo próprio); mapa (1 consulta por município),
// busca, composição e o SSE seguem bloqueados. No Google vale a regra mais longa, então os Allow vencem o Disallow.
const ROBOTS_API_LIBERADA = ['/api/config', '/api/municipios', '/api/resultado', '/api/candidato/'];

export function responderRobots(req, res) {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' });
  const liberadas = ROBOTS_API_LIBERADA.map((r) => `Allow: ${r}\n`).join('');
  res.end(`User-agent: *\nAllow: /\n${liberadas}Disallow: /api/\n\nSitemap: ${baseDe(req)}/sitemap.xml\n`);
}

/** "04/10/2026 12:30:21" → "2026-10-04" */
const dataIso = (s) => {
  const m = /^(\d\d)\/(\d\d)\/(\d{4})/.exec(s ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const maisRecente = (...datas) => datas.filter(Boolean).sort().at(-1) ?? null;

const urlset = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
  .map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;

/**
 * Sitemaps: o índice (/sitemap.xml) e os filhos — geral (início, cargos, cargo × UF), um por cargo (municípios,
 * com o slug do nome) e candidatos. Zonas ficam de fora (conteúdo fino); o 2º turno só entra com a flag ligada
 * (flags públicas, sem prévia). `lastmod` só onde há data verdadeira: a do resultado final no arquivo e a do
 * perfil dos candidatos.
 */
async function gerarSitemap(nome, base) {
  const cfg = await getConfig();
  const flags = flagsDe({ headers: {} });
  const cargos = cfg.cargos.filter((c) => cargoVisivel(c, flags));
  const dataCargo = (c) => dataFinal(CICLO, c.eleicao);
  const dataCands = async () => maisRecente(dataIso(await geradoEm().catch(() => null)), ...cargos.filter(cargoFinal).map(dataCargo));

  if (nome === 'sitemap') {
    const filhos = [
      { loc: `${base}/sitemap-geral.xml`, lastmod: maisRecente(...cargos.map(dataCargo)) },
      ...cargos.map((c) => ({ loc: `${base}/sitemap-${slugCargo(c)}.xml`, lastmod: dataCargo(c) })),
      { loc: `${base}/sitemap-candidatos.xml`, lastmod: await dataCands() },
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${filhos
      .map((f) => `<sitemap><loc>${esc(f.loc)}</loc>${f.lastmod ? `<lastmod>${f.lastmod}</lastmod>` : ''}</sitemap>`).join('\n')}\n</sitemapindex>\n`;
  }
  if (nome === 'sitemap-geral') {
    const urls = [{ loc: `${base}/` }];
    for (const c of cargos) {
      const slug = slugCargo(c);
      urls.push({ loc: `${base}/${slug}`, lastmod: dataCargo(c) });
      for (const uf of c.ufs) urls.push({ loc: `${base}${caminho({ cargo: slug, uf })}`, lastmod: dataCargo(c) });
    }
    return urlset(urls);
  }
  if (nome === 'sitemap-candidatos') {
    const lastmod = await dataCands();
    const visiveis = new Set(cargos.map((c) => c.id));
    const urls = [];
    for (const [sq, lista] of await indiceCandidatos()) {
      const e = lista.find((x) => visiveis.has(x.cargoId));
      if (e) urls.push({ loc: `${base}${caminhoCandidato(sq, e.nomeUrna)}`, lastmod });
    }
    return urlset(urls);
  }
  const c = cargos.find((x) => `sitemap-${slugCargo(x)}` === nome);
  if (!c) return null;
  const slug = slugCargo(c);
  const muns = await municipiosDe(c, cfg);
  const urls = [];
  for (const uf of c.ufs) {
    for (const m of muns[uf]?.municipios ?? []) {
      urls.push({ loc: `${base}${caminho({ cargo: slug, uf, mun: m.cd, munNome: m.nome })}`, lastmod: dataCargo(c) });
    }
  }
  return urlset(urls);
}

const sitemaps = new Map(); // "base|nome|turno" → { ts, p: Promise<{ corpo, etag } | null> }
const SITEMAP_TTL = 60 * 60_000;

/** /sitemap.xml e /sitemap-<nome>.xml, gerados no 1º pedido e guardados por 1 h (com ETag). Devolve false se não é sitemap. */
export async function responderSitemap(req, res, pathname) {
  const m = /^\/(sitemap(?:-[a-z0-9-]+)?)\.xml$/.exec(pathname);
  if (!m) return false;
  const base = baseDe(req);
  const chave = `${base}|${m[1]}|${flagsDe({ headers: {} }).segundoTurno ? 2 : 1}`;
  let hit = sitemaps.get(chave);
  if (!hit || Date.now() - hit.ts > SITEMAP_TTL) {
    // Guardado também em gzip (o de candidatos passa de 2 MB).
    const p = gerarSitemap(m[1], base).then((corpo) => corpo && {
      corpo, gz: zlib.gzipSync(corpo), etag: `"${createHash('sha1').update(corpo).digest('base64url').slice(0, 22)}"`,
    });
    p.catch(() => sitemaps.delete(chave));
    hit = { ts: Date.now(), p };
    sitemaps.set(chave, hit);
  }
  const s = await hit.p;
  if (!s) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
    res.end('Sitemap inexistente.');
    return true;
  }
  const cabecalhos = { etag: s.etag, 'cache-control': 'public, max-age=3600', vary: 'accept-encoding' };
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (req.headers['if-none-match'] === s.etag) {
    res.writeHead(304, cabecalhos);
  } else {
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', ...(gzip && { 'content-encoding': 'gzip' }), ...cabecalhos });
    res.write(gzip ? s.gz : s.corpo);
  }
  res.end();
  return true;
}
