// fetchJson (server/tse/fonte.mjs) com o fetch simulado: cache, deduplicação, consulta condicional (304), 404, e a
// pausa geral após 429. URLs de um ciclo que o arquivo próprio não cobre, para tudo passar pela "rede".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErroTse, fetchJson } from '../../server/tse/fonte.mjs';
import { TSE_BASE } from '../../server/tse/urls.mjs';

const url = (nome) => `${TSE_BASE}/teste-fonte/${nome}.json`;
const pedidos = [];
let responder = () => new Response('{}');
globalThis.fetch = async (u, opcoes) => {
  pedidos.push({ u, cabecalhos: opcoes?.headers ?? {} });
  return responder(u, opcoes);
};
const json = (corpo, init = {}) => new Response(JSON.stringify(corpo), { status: 200, ...init });

test('pedidos simultâneos da mesma URL viram uma consulta; dentro do TTL, o cache responde', async () => {
  pedidos.length = 0;
  responder = () => json({ v: 1 });
  const [a, b] = await Promise.all([fetchJson(url('dedup'), 60_000), fetchJson(url('dedup'), 60_000)]);
  assert.deepEqual(a, { v: 1 });
  assert.equal(a, b);
  assert.equal(await fetchJson(url('dedup'), 60_000), a);
  assert.equal(pedidos.length, 1);
});

test('vencido, consulta com If-None-Match e um 304 mantém o mesmo objeto', async () => {
  pedidos.length = 0;
  responder = () => json({ v: 2 }, { headers: { etag: '"abc"' } });
  const primeiro = await fetchJson(url('etag'), 0);
  responder = () => new Response(null, { status: 304 });
  const segundo = await fetchJson(url('etag'), 0);
  assert.equal(segundo, primeiro);
  assert.equal(pedidos[1].cabecalhos['if-none-match'], '"abc"');
});

test('404 vira null', async () => {
  responder = () => new Response('', { status: 404 });
  assert.equal(await fetchJson(url('inexistente'), 60_000), null);
});

test('429: quem tem cache recebe o dado antigo e as demais consultas ao TSE ficam pausadas', async () => {
  responder = () => json({ v: 3 });
  const antigo = await fetchJson(url('limitada'), 0);
  responder = () => new Response('', { status: 429, headers: { 'retry-after': '1' } });
  assert.equal(await fetchJson(url('limitada'), 0), antigo);
  const antes = pedidos.length;
  await assert.rejects(fetchJson(url('outra'), 0), (e) => e instanceof ErroTse && /pausada/.test(e.message));
  assert.equal(pedidos.length, antes, 'durante a pausa nada vai ao TSE');
});
