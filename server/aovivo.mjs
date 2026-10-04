// "Ao vivo" via Server-Sent Events: para cada resultado assistido, UM vigia consulta o TSE a cada
// VERIFICA_MS e empurra o JSON a todos os navegadores conectados apenas quando o conteúdo muda.
// Assim o TSE recebe a mesma carga com 1 ou 1.000 espectadores.

import { getResultado } from './tse.mjs';

export const VERIFICA_MS = Number(process.env.AO_VIVO_MS || 5000);
const HEARTBEAT_MS = 20_000;

const vigias = new Map(); // chave -> { params, clientes:Set<res>, ultimo:string|null, timer }

function enviar(res, evento, dados) {
  res.write(`event: ${evento}\ndata: ${dados}\n\n`);
}

async function verificar(chave) {
  const v = vigias.get(chave);
  if (!v) return;
  try {
    // TTL um pouco menor que o intervalo; mesmo assim, enquanto o Akamai do TSE não renova o arquivo
    // (max-age, ~60 s), a verificação usa o cache — consultar antes só traria o mesmo arquivo.
    const r = await getResultado(v.params, VERIFICA_MS - 500);
    const corpo = r ? JSON.stringify(r) : null;
    const agora = Date.now();
    if (!r) {
      for (const c of v.clientes) enviar(c, 'erro', JSON.stringify({ erro: 'Sem dados para esta abrangência/cargo.' }));
    } else if (corpo !== v.ultimo) {
      v.ultimo = corpo;
      for (const c of v.clientes) enviar(c, 'resultado', corpo);
    }
    for (const c of v.clientes) enviar(c, 'verificado', String(agora));
  } catch (err) {
    for (const c of v.clientes) enviar(c, 'erro', JSON.stringify({ erro: `Falha ao consultar o TSE: ${err.message}` }));
  }
}

/** Atende GET /api/ao-vivo (params já validados). Mantém a conexão aberta. */
export function assinar(req, res, params) {
  const chave = JSON.stringify(params);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no', // não deixar proxies (nginx) segurarem os eventos
  });
  enviar(res, 'config', JSON.stringify({ intervalo: VERIFICA_MS }));

  let v = vigias.get(chave);
  if (!v) {
    v = { params, clientes: new Set(), ultimo: null, timer: null };
    vigias.set(chave, v);
    v.timer = setInterval(() => verificar(chave), VERIFICA_MS);
    v.clientes.add(res);
    verificar(chave);
  } else {
    v.clientes.add(res);
    if (v.ultimo) enviar(res, 'resultado', v.ultimo); // quem chega recebe o estado atual na hora
  }

  const batimento = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(batimento);
    v.clientes.delete(res);
    if (v.clientes.size === 0) {
      clearInterval(v.timer);
      vigias.delete(chave);
    }
  });
}
