// Feature toggles: o que vai ao público sem depender de deploy.
//
// Cada flag tem um padrão aqui e aceita a variável FLAG_<NOME> (ex.: FLAG_SEGUNDO_TURNO) com
// `on` | `off` | data ISO 8601 (liga sozinha nesse horário — sem reiniciar nem mexer no Render).
// Durante a apuração, mudar variável no Render reinicia o serviço e esvazia o cache; para isso há
// POST /api/flags (com ADMIN_TOKEN), que muda a flag em memória até o próximo reinício.
//
// Prévia: com ADMIN_TOKEN definido, /api/preview?token=<token> grava um cookie e esse navegador vê
// tudo ligado (para conferir em produção antes de liberar); /api/preview?sair apaga o cookie.
// As flags valem no servidor: desligada, a rota recusa o pedido — não é só o front que esconde.

import { timingSafeEqual } from 'node:crypto';

const DEFINICOES = {
  // O TSE publica a eleição do 2º turno na configuração geral dias antes; sem esta flag ela
  // apareceria sozinha. Padrão: o dia da votação (25/10/2026, último domingo de outubro).
  segundoTurno: { env: 'FLAG_SEGUNDO_TURNO', padrao: '2026-10-25T00:00:00-03:00' },
  hemiciclo: { env: 'FLAG_HEMICICLO', padrao: 'on' },
  // Kill switches: a busca é a parte mais pesada (indexa ~140 arquivos do TSE); o "ao vivo" (SSE)
  // pode apertar o plano gratuito com muitos acessos — desligado, o front atualiza a cada 30 s.
  busca: { env: 'FLAG_BUSCA', padrao: 'on' },
  aoVivo: { env: 'FLAG_AO_VIVO', padrao: 'on' },
};

export const NOMES_FLAGS = Object.keys(DEFINICOES);

/** "on"/"off"/data ISO → { liga: número (ms) | 0 = sempre | Infinity = nunca }, ou null se inválido. */
function interpretar(valor) {
  const v = String(valor).trim().toLowerCase();
  if (['on', '1', 'true', 'sim'].includes(v)) return 0;
  if (['off', '0', 'false', 'nao', 'não'].includes(v)) return Infinity;
  const ms = Date.parse(String(valor).trim());
  return Number.isNaN(ms) ? null : ms;
}

const estado = {}; // nome -> { liga, valor, origem: 'padrão' | 'env' | 'admin' }
for (const [nome, d] of Object.entries(DEFINICOES)) {
  const doEnv = process.env[d.env];
  const liga = doEnv != null && doEnv !== '' ? interpretar(doEnv) : null;
  if (doEnv && liga == null) console.warn(`${d.env}="${doEnv}" inválido (use on, off ou data ISO 8601); usando o padrão.`);
  estado[nome] = liga != null
    ? { liga, valor: doEnv, origem: 'env' }
    : { liga: interpretar(d.padrao), valor: d.padrao, origem: 'padrão' };
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const COOKIE = 'previa';

function tokenValido(t) {
  if (!ADMIN_TOKEN || !t) return false;
  const a = Buffer.from(String(t));
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function lerCookie(req, nome) {
  for (const parte of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const emPrevia = (req) => tokenValido(lerCookie(req, COOKIE));

/** Flags efetivas para este pedido: { segundoTurno: bool, ..., previa: bool }. */
export function flagsDe(req) {
  const previa = emPrevia(req);
  const agora = Date.now();
  const out = { previa };
  for (const nome of NOMES_FLAGS) out[nome] = previa || estado[nome].liga <= agora;
  return out;
}

/** O cargo (da config) pode ser mostrado com estas flags? */
export const cargoVisivel = (cargo, flags) => cargo.turno !== 2 || flags.segundoTurno;

// ---------- rotas de administração ----------

/** GET /api/preview?token=… liga a prévia neste navegador; ?sair desliga. Redireciona para a página. */
export function rotaPreview(req, res, url) {
  const seguro = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  let cookie;
  if (url.searchParams.has('sair')) {
    cookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${seguro}`;
  } else if (tokenValido(url.searchParams.get('token'))) {
    cookie = `${COOKIE}=${encodeURIComponent(ADMIN_TOKEN)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${seguro}`;
  } else {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(ADMIN_TOKEN ? 'Token inválido.' : 'Prévia desativada: defina ADMIN_TOKEN no servidor.');
  }
  res.writeHead(302, { 'set-cookie': cookie, location: '/', 'cache-control': 'no-store' });
  res.end();
}

function situacao() {
  const agora = Date.now();
  return Object.fromEntries(NOMES_FLAGS.map((nome) => {
    const e = estado[nome];
    return [nome, { ligada: e.liga <= agora, valor: e.valor, origem: e.origem, env: DEFINICOES[nome].env }];
  }));
}

/**
 * GET /api/flags → situação de cada flag; POST /api/flags?<nome>=on|off|<data ISO>|padrao → muda em
 * memória (vale até o processo reiniciar). Exige `Authorization: Bearer <ADMIN_TOKEN>`.
 */
export function rotaFlags(req, res, url) {
  const responder = (status, corpo) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(corpo, null, 2));
  };
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tokenValido(token)) return responder(ADMIN_TOKEN ? 401 : 403, { erro: ADMIN_TOKEN ? 'token inválido' : 'defina ADMIN_TOKEN no servidor' });
  if (req.method === 'POST') {
    const mudancas = [...url.searchParams];
    for (const [nome] of mudancas) if (!estado[nome]) return responder(400, { erro: `flag desconhecida: ${nome}`, flags: NOMES_FLAGS });
    for (const [nome, valor] of mudancas) {
      const padrao = /^padr[aã]o$/i.test(valor);
      const v = padrao ? (process.env[DEFINICOES[nome].env] || DEFINICOES[nome].padrao) : valor;
      const liga = interpretar(v);
      if (liga == null) return responder(400, { erro: `valor inválido para ${nome}: ${valor} (use on, off, data ISO ou padrao)` });
      estado[nome] = { liga, valor: v, origem: padrao ? (process.env[DEFINICOES[nome].env] ? 'env' : 'padrão') : 'admin' };
      console.log(`flag ${nome} = ${v} (${estado[nome].origem})`);
    }
  } else if (req.method !== 'GET') {
    return responder(405, { erro: 'use GET ou POST' });
  }
  responder(200, situacao());
}
