# Apuração 2026 — CLAUDE.md

App web para acompanhar a apuração das Eleições Gerais 2026 (1º turno em 04/10/2026) com dados
oficiais do TSE: mapa interativo com funil **Brasil → UF → município → zona eleitoral** e busca de
candidatos por nome/número ou partido.

Idioma do projeto: **português** (código, UI, comentários e commits).

## Comandos

```bash
npm install
npm run dev        # API (porta 3001) + Vite (porta 5173, proxy /api → 3001)
npm run demo       # igual ao dev, mas com votos sintéticos (DEMO=1) — útil antes das 17h de Brasília
npm run typecheck  # front (tsconfig.json) e servidor (tsconfig.server.json, checkJs) contra o contrato da API
npm test           # testes (node:test, sem dependências); npm run test:atualizar regera os snapshots
npm run candidatos # regera dados/candidatos-2026.tsv.gz (perfil e bens, Dados Abertos do TSE)
npm run arquivar   # guarda os resultados finais em arquivo/ (ver "Arquivo próprio" abaixo)
npm run simular-2turno  # regera a simulação do 2º turno em simulacao/ (ver "Simulação do 2º turno")
npm run dev:2turno # dev com a simulação do 2º turno ligada (SIMULACAO_2TURNO=1 FLAG_SEGUNDO_TURNO=on)
npm run zonas      # regera dados/zonas-2026.json.gz (contorno estimado das zonas; ver "Zonas no mapa" abaixo)
npm run malhas     # regera dados/malhas/<uf|br>.json.gz (malhas do IBGE do mapa; ver "Malhas do IBGE" abaixo)
npm run icones     # regera os PNGs do PWA a partir de public/favicon.svg e public/icone-maskable.svg (precisa do rsvg-convert)
npm run og         # regera public/og.png (1200×630) de server/scripts/og.html (precisa do chromium e de internet p/ as fontes)
npm run build && npm start   # produção: o servidor Node serve dist/ e /api na porta 3001
```

Variáveis de ambiente do servidor: `PORT` (3001), `DEMO=1`, `DEMO_MINUTOS` (15; tempo até a demo
chegar a 100%), `AO_VIVO_MS` (5000; verificação do TSE no modo ao vivo), `CICLO` (`ele2026`; trocar para testar com outro ciclo), `ENCERRAMENTO` (ISO 8601;
sobrescreve o fechamento das urnas para testar o aviso, ex. `ENCERRAMENTO=2026-10-04T13:00:00-03:00`),
`CACHE_MB` (28; teto do cache de respostas do TSE, em MB de texto — ~6x isso no heap; o `/api/saude` mostra
`memoria` e o log avisa "memória alta" acima de 400 MB de RSS), `ARQUIVO=1` (usa só o arquivo próprio para tudo o que ele cobre, sem consultar o TSE; eleições já todas finais no
arquivo saem dele mesmo sem a variável), `ARQUIVO_MB` (16; unidades
do arquivo abertas em memória), `SIMULACAO_2TURNO=1` (serve o 2º turno simulado de `simulacao/`; nunca em produção
aberta ao público), `SITE_URL` (ex. `https://dominio.com.br`, sem barra final: base do canonical, og:url, robots e
sitemap; definida, todo pedido por outro host recebe 301 para o mesmo caminho nela, menos `/api/*` — defina só com o
domínio já respondendo e antes do dia da eleição, porque mudar variável reinicia o serviço e o 301 fica guardado nos
navegadores; sem ela, a base vem de `x-forwarded-proto` + `host`).

### Feature toggles (`server/flags.mjs`)

O que vai ao público sem depender de deploy. Cada flag aceita `FLAG_<NOME>` = `on` | `off` | data ISO 8601
(liga sozinha nesse horário, sem reiniciar). As flags valem **no servidor** (rota recusa o pedido; cargo
escondido responde como desconhecido), e o front recebe as efetivas em `/api/config` → `flags`.

| Flag | Variável | Padrão | O que faz |
|---|---|---|---|
| `segundoTurno` | `FLAG_SEGUNDO_TURNO` | `2026-10-25T00:00:00-03:00` | esconde as eleições com `t=2` (o TSE as publica dias antes) |
| `hemiciclo` | `FLAG_HEMICICLO` | `on` | composição das casas (`/api/composicao`) |
| `busca` | `FLAG_BUSCA` | `on` | kill switch da busca (a rota mais pesada) |
| `aoVivo` | `FLAG_AO_VIVO` | `on` | kill switch do SSE; desligado, o front atualiza a cada 30 s |

Com `ADMIN_TOKEN` definido:
- **Prévia**: abrir `/api/preview?token=<ADMIN_TOKEN>` grava um cookie e esse navegador vê tudo ligado (selo
  "PRÉVIA · sair" no topo); `/api/preview?sair` desliga.
- **Mudar sem reiniciar** (mudar variável no Render reinicia e esvazia o cache — evitar durante a apuração):
  `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://…/api/flags?busca=off"` (valores: `on`, `off`,
  data ISO ou `padrao`); `GET /api/flags` mostra a situação. Vale em memória até o próximo reinício.

## Arquitetura

```
compartilhado/     O que front e servidor usam igual, sem build
  api.d.mts        Contrato da API: tipos de cada resposta (/api/config, /resultado, /mapa, /busca, /composicao…).
                   O front importa (`import type`, via src/lib/types.ts) e o servidor anota em JSDoc (`@import`,
                   `@returns`); `npm run typecheck` confere os dois lados. Só tipos: não existe api.mjs
  rotas.mjs        Rotas públicas e títulos das páginas (tipos em rotas.d.mts); front e server/seo.mjs
  nomes.mjs        titulo ("SÃO JOSÉ" → "São José"), cargoBase e nomeCargo (tipos em nomes.d.mts): o <title> do
                   servidor bate com o do front; o front reexporta por lib/util.ts e dominio/cargo.ts
server/            Node puro (ESM, sem dependências) — o TSE não envia CORS, então tudo passa aqui
  index.mjs        Servidor HTTP: despacho das rotas (as JSON vêm da tabela de rotas/index.mjs; malhas, candidato,
                   SSE e prévia/flags têm resposta própria), ETag/304 das respostas JSON, arquivos estáticos
  http.mjs         HttpError, etagDe (API e sitemaps) e validação comum (cargoDe, validarUf)
  rotas/           Uma rota (ou par de rotas) por arquivo; cada handler (query, flags) declara o tipo da resposta
    index.mjs        Tabela caminho → handler (ROTAS_JSON)
    config.mjs       /api/config (config + `encerrada` + flags) e /api/municipios
    resultado.mjs    /api/resultado (e paramsResultado, usado também pelo SSE)
    mapa.mjs         /api/mapa: resumo por UF, município ou zona (`virou` no 2º turno)
    composicao.mjs   /api/composicao: cadeiras por partido
    busca.mjs        /api/busca: índice em memória dos candidatos
    geo.mjs          /api/geo/<uf|br> (malhas do IBGE, em memória após o 1º pedido) e /api/zonas (contorno estimado,
                     de dados/zonas-2026.json.gz)
    saude.mjs        /api/saude e o alerta de memória no log
  aovivo.mjs       Stream SSE /api/ao-vivo: 1 vigia por resultado consulta o TSE a cada 5 s e empurra só quando muda
  tse.mjs          Cliente TSE (fachada): config, municípios, resultados (getResultado, getResultadosRapidos,
                   getResultadoSemTse), abrangência e apuração encerrada; as peças ficam em tse/:
    tse/urls.mjs     Endereços dos arquivos (resultadoUrl, fotoUrl), TSE_BASE, CICLO, UFS
    tse/cache.mjs    Cache em memória (LRU por tamanho, validadores HTTP, `vale()`, resultado normalizado junto do JSON)
    tse/fila.mjs     Fila com taxa e prioridade; pausa geral após 429
    tse/fonte.mjs    fetchJson: cache + dedup + fila + arquivo próprio (reserva ou fonte única)
    tse/apuracao.mjs Regras puras: normalizar, classificar, situacaoMatematica, QE, chapas, resumo (testadas)
  demo.mjs         Gera votos determinísticos sobre os arquivos reais (candidatos reais); arquivo com votos (arquivo
                   próprio, simulação) segue a proporção real e só mostra a situação ao chegar a 100%
  malhas.mjs       Malhas do IBGE: dados/malhas, senão .cache/geo, senão o IBGE (com a CA de server/certs/)
  arquivo.mjs      Arquivo próprio: formato compacto (compacta/remonta) e leitura pelas URLs do TSE
  flags.mjs        Feature toggles (FLAG_*), prévia por cookie e /api/flags (ADMIN_TOKEN)
  simulacao.mjs    Simulação do 2º turno (SIMULACAO_2TURNO=1): pleito acrescentado ao ele-c.json e fotos do 1º turno
  candidatos.mjs   /api/candidato/:sq — perfil e bens; lê dados/candidatos-2026.tsv.gz no 1º pedido (buffer + índice)
  seo.mjs          HTML por rota (title, description, canonical, Open Graph, JSON-LD, resumo em texto no #root), 404 de
                   verdade, robots.txt, sitemaps, SITE_URL/301 e `candidatura` do /api/candidato (ver "SEO" abaixo)
  scripts/comum.mjs       O que os scripts usam igual: opcao(), zips dos Dados Abertos (.cache/dados-abertos),
                          lerCsv (latin1, ";") e gravarJson (gzip determinístico, via .tmp)
  scripts/candidatos.mjs  `npm run candidatos`: baixa os CSVs dos Dados Abertos e gera o .tsv.gz
  scripts/arquivar.mjs    `npm run arquivar`: baixa os resultados finais e grava em arquivo/
  scripts/simular-2turno.mjs  `npm run simular-2turno`: gera simulacao/ a partir do 2º turno de 2022
  scripts/zonas.mjs       `npm run zonas`: contorno estimado das zonas a partir dos locais de votação
  scripts/malhas.mjs      `npm run malhas`: grava as malhas do IBGE em dados/malhas
dados/             Arquivos gerados e versionados (candidatos-2026.tsv.gz, zonas-2026.json.gz, malhas/)
arquivo/           Resultados finais arquivados e versionados (<ciclo>-<turno>turno/)
simulacao/         2º turno simulado (mesmo formato do arquivo/), versionado
src/               React 19 + TypeScript + Vite + TanStack Query; d3-geo só para gerar os paths SVG
                   Pastas por funcionalidade: uma pasta de features/ nunca importa outra (só api/, rota/, apuracao/,
                   ui/ e lib/); o que duas features usam sobe para ui/ ou lib/, e o App junta tudo
  main.tsx         Monta o App dentro dos Providers
  app/
    App.tsx            Composição da tela (~180 linhas): rota, useDadosTela, navegação (NavegacaoContext) e o estado
                       da interface (modo do mapa, "ao vivo", filtro da busca, índice aberto); distribui aos componentes
    useDadosTela.ts    Todas as consultas da tela e o que se deriva delas (cargo/UF/local, fase, município aberto,
                       placar, cores do 2º turno, situação da apuração); `pronta: false` até a config chegar
    usePrefetch.ts     Prefetch do resultado da tela de destino de um link (ponteiro parado ou foco)
    Topo.tsx, FaixaStatus.tsx, CabecalhoTela.tsx, PainelMapa.tsx  Blocos da tela; recebem `d` (DadosTela)
    Lateral.tsx        lateralDe(): a coluna ao lado do mapa conforme a tela (ou null, sem coluna)
    providers.tsx      QueryClient (sem retry automático, sem polling em aba oculta, gcTime 30 min)
  api/
    cliente.ts         getJson (timeout 30 s, conta requisições ativas para a barra do topo), URLs, cópia no
                       sessionStorage (respostas até 150 KB, 30 min) para o F5
    consultas.ts       Todos os recursos da API num lugar: URL, chave do cache (recurso + URL) e `staleTime`
                       (`VALE_APURANDO_MS` 20 s, `VALE_PARADO_MS` 5 min, 24 h para config/municípios/malhas)
    useConsulta.ts     useConsulta(consulta | null, { intervalo, incompleto, sse }) → { data, erro, carregando,
                       proxima, aoVivo }; o SSE grava no cache (setQueryData); mesma chave = 1 requisição para todos
  rota/
    rota.ts            Tela/Rota, leitura da URL (inclui links antigos #/…) e useRota() (popstate)
    useNavegacao.ts    caminhoDe, ir, irHome, abrir/fechar a ficha (pushState/replaceState)
    resolver.ts        resolverTela(): cargo, UF e local de uma tela (App e prefetch usam o mesmo)
    Link.tsx           <a href> com navegação SPA no clique simples (ctrl/cmd/meio abrem nova aba); toda navegação
                       usa links de verdade para o Google rastrear. Ponteiro parado 120 ms ou foco: adianta o
                       resultado do destino (o mapa fica para o clique). `LinkTela para={local} cargo?`: href e
                       navegação do `NavegacaoContext` (caminhoDe, ir, prefetch; fornecido pelo App);
                       `useNavegacaoTela()` para o que não é link (regiões do mapa SVG)
  apuracao/
    useFaseApuracao.ts Aberta/encerrada/tempo real, intervalos (`ATUALIZA_*_MS`) e `vale` (staleTime) do momento
    AvisoVotacao.tsx   Faixa âmbar acima da faixa de status: "votação ainda não começou / em andamento (contagem
                       HH:MM:SS) / urnas fechadas"
    useRelogio.ts      Relógio que só anda enquanto ativo (15 s na fase da apuração, 1 s nas contagens regressivas)
    ProximaAtualizacao.tsx "a cada 30 s · próxima em 12 s" (usa `proxima` do useConsulta); na faixa de status
    ProximoPlantao.tsx Caixa "Próximo plantão" (2º turno na config, votação ainda não começou)
  features/
    mapa/
      Mapa.tsx           Choropleth SVG (projeção plana própria), tooltip, legenda, zoom no município;
                         zoom/arraste do leitor (roda, arrastar, pinça, botões +/−/Ajustar) via viewBox;
                         prop `zonas`: desenha as zonas sobre o município em foco, com a mesma projeção
      TickerUFs.tsx      Faixa rolável com o líder de cada UF (nível Brasil, majoritários), do mesmo /api/mapa
      DiferencaUF.tsx    Ao lado do mapa do Brasil (Presidente): diferença entre os dois primeiros em cada UF
      DestaquesUF.tsx    Ao lado do mapa da UF (majoritários): maiores eleitorados e disputas mais apertadas
                         (acima de 75 mil eleitores), com `segundo`/`eleitorado` do /api/mapa
      AvisoMapa.tsx, CartaoExterior.tsx, IndiceRegioes.tsx  Falha/regiões faltando, cartão do exterior, lista de links
    resultado/
      Placar.tsx         Os dois primeiros (no 2º turno, os finalistas) acima do mapa: nome, % dos válidos em letras
                         grandes, votos, regiões vencidas, exterior; barra 1º | outros | 2º com a marca dos 50%;
                         `compacto` nas telas de UF/município/zona; antes dos votos do 2º turno, "––,––%" e o 1º turno
      PainelResultado.tsx Tabela de todos os candidatos (filtro local) e o comparecimento
      Duelo.tsx          2º turno: `ListaDuelos` (cargos estaduais no nível Brasil, uma linha por UF)
    candidato/
      FichaCandidato.tsx Ficha aberta (sq da rota) sobre a tela; ModalCandidato em chunk próprio (React.lazy)
      ModalCandidato.tsx Ficha do candidato (<dialog>): resultado + perfil, candidatura e bens declarados
      useFichaPelaUrl.ts Ficha aberta direto pela URL: acha a tela por baixo (perfil, senão a busca pelo nome)
    busca/
      BarraBusca.tsx     Busca global (debounce 300 ms) com filtros de cargo/UF/partido; só o partido lista
                         todos os candidatos dele, agrupados por cargo, em páginas ("Mostrar mais")
    composicao/
      Hemiciclo.tsx      Composição da casa legislativa (uma bolinha por cadeira, cor do partido) abaixo do mapa,
                         via /api/composicao: Senado (sempre o Brasil, 54 cadeiras em disputa), Câmara (UF ou
                         Brasil), Assembleia/Câmara Legislativa (UF). Sem `st` oficial, usa os eleitos projetados.
                         Cadeiras na ordem dos `eleitos` da API (partido por bancada, depois votos); a lista abaixo
                         mostra cada cadeira e seu dono, agrupada por partido: cabeçalho do partido destaca a
                         bancada, linha/bolinha destaca a cadeira e abre a ficha do eleito sobre o plenário;
                         clique fixa a cadeira em foco até um clique fora do componente ou ESC. Chunk próprio
      casa.ts            casaLegislativa(): qual casa o cargo elege na abrangência atual
  ui/
    Carregando.tsx     Barra fina no topo (conta requisições ativas em getJson) + esqueletos de página/painel/mapa
    ListaRegioes.tsx   Lista clicável para regiões sem malha (zonas, cidades no exterior, UFs)
    Num.tsx            Número ao vivo: conta do valor antigo ao novo e realça ao mudar; pulsa sob `.atualizando`
    SeloSituacao.tsx, Logo.tsx, BotaoTema.tsx, SeletorMunicipio.tsx
  dominio/           Regras da tela em funções puras (.ts, sem React; testadas em testes/front/dominio.test.mjs)
    cargo.ts         cargoBase, nomeCargo, turnosDe, localCargo, destinoTurno (troca de cargo/turno mantendo a UF)
    fase.ts          faseVotacao (antes/votando/aguardando/…), situacaoApuracao (% apurado, TSE indisponível), rotuloEstado
    duelo.ts         2º turno: finalistas, coresFinalistas, corDoLider
    placar.ts        placarDe (os dois da frente ou os finalistas, com cores), regioesVencidas, pctNaRegiao, primeiroNome
    situacao.ts      textoSituacao: "Eleito", "Vai ao 2º turno", "Matematicamente eleito"… (placar e ficha)
    titulo.ts        tituloDaAba (document.title), nomeDaRegiao
  lib/
    util.ts          Formatação pt-BR, nomes das UFs, cores dos partidos e o ajuste delas ao tema (OKLCH)
    tema.ts          useTema()/definirTema() (data-tema + prefers-color-scheme) e useCores() (cores de partido no tema)
    types.ts         Reexporta compartilhado/api.d.mts (+ tipos só do front, como ModoMapa)
  styles.css       Tema único ("Plantão") — tokens em variáveis CSS no :root
```

### Arquitetura do front

**Arquitetura por funcionalidade** (*feature-based*/*package by feature*, no estilo do Bulletproof React), com o
TanStack Query como camada de estado do servidor. Reforma feita em outubro de 2026 (branch `feature/architecture`),
antes do 2º turno, em fases que podem ser revertidas uma a uma. Segunda reforma (branch `refactor/arquitetura`,
um commit por fase): testes e CI, `App.tsx` dividido (`useDadosTela`, blocos em `app/`, `dominio/`, `NavegacaoContext`),
contrato da API em `compartilhado/` com `checkJs` no servidor, `tse.mjs`/`index.mjs` separados em `server/tse/` e
`server/rotas/`, e `memo` nos componentes pesados (re-render a cada evento do "ao vivo").

**Camadas e regra de importação** (só para baixo; nunca entre features):

```
app/            composição: junta rota, config, fase e consultas e distribui por props
  ↓
features/*      uma pasta por funcionalidade (mapa, resultado, candidato, busca, composicao)
  ↓
api/  rota/  apuracao/      infraestrutura do app: consultas, URL/navegação, fase da apuração
  ↓
ui/  dominio/  lib/         peças sem regra de negócio (Num, esqueletos, Logo…), regras puras da tela e utilitários/tipos
```
- `dominio/` só importa `lib/` (e `compartilhado/`): sem React, testável no Node. Regra que decide o que a tela mostra
  (fase, placar, títulos, troca de turno) vai para lá, não para um `.tsx` — `.tsx` não roda nos testes.
- `ui/` usa `rota/Link` (o `LinkTela`), a única exceção ao "só para baixo"; links nunca recebem `href` + `onSelect`
  à mão: recebem a tela de destino (`para`/`destino: (chave) => Local`).
- Uma feature não importa outra. O que duas usam sobe para `ui/` ou `lib/`; o que precisa das duas é montado no
  App (ex.: a ficha saiu de dentro do `PainelResultado` e virou `FichaCandidato`, renderizada pelo App, porque o
  `<dialog>` modal não depende de onde está no DOM).
- `compartilhado/` fica fora de `src/` porque o servidor também usa: `rotas.mjs` (mudou o formato de uma rota, muda
  nos dois lados) e o contrato `api.d.mts`. Campo novo numa resposta: tipo em `api.d.mts` primeiro; o servidor
  declara o tipo de cada rota em JSDoc e o `typecheck` acusa campo a mais, a menos ou com nome trocado. O servidor
  roda com `strict: false` (o JSON do TSE chega como `any`): o tipo de um valor lido do TSE não é conferido.

**Fluxo de dados**

1. `useRota()` lê a URL → `resolverTela(config, tela)` dá cargo, UF e local (o mesmo para a tela atual e para o
   prefetch dos links).
2. `useFaseApuracao(cargo, aoVivo)` decide o ritmo: antes das 17h nada se repete; durante a apuração, SSE (resultado)
   + polling (mapa, composição); encerrada, só repete o que veio incompleto. Também dá o `vale` (`staleTime`).
3. `app/useDadosTela.ts` chama `useConsulta(consultas.<recurso>(…, vale), { intervalo, incompleto, sse })` e o App
   passa `data`/`erro`/`carregando` (ou o `d` inteiro, nos blocos de `app/`) aos componentes. Os componentes não buscam dados sozinhos, exceto a ficha (perfil) e a busca.
4. Com SSE, o stream grava no cache da consulta (`setQueryData`); a consulta fica com `skipToken` (sem buscar).

**Decisões (e o que foi descartado)**

| Tema | Escolha | Por quê | Descartado |
|---|---|---|---|
| Pastas | Por funcionalidade, regra de importação em um sentido | `App.tsx` com 939 linhas e `components/` plano já não escalavam | Feature-Sliced Design (camadas `pages`/`widgets`/`entities` demais para ~30 componentes) |
| Estado do servidor | TanStack Query 5 (versão fixa, sem `^`) | Dedup por chave, `staleTime`, polling condicional, prefetch, cache entre telas; antes era tudo à mão no `useApi` | SWR (sem prefetch/devtools tão completos), RTK Query (traz Redux), manter o `useApi` |
| Roteamento | Roteador próprio (`rotas.mjs` + `useRota`/`useNavegacao`) | O mesmo arquivo valida rotas e gera títulos no servidor (SEO, 404 de verdade) | TanStack Router e React Router 7 (duplicariam as rotas e arriscariam o SEO) |
| Estado da interface | `useState` no App + props; um contexto só (`NavegacaoContext`: caminhoDe, ir, prefetch) | O estado global de verdade é rota + config; a navegação vale para a tela inteira e tirou os pares `href`/`onSelect` de todos os links | Zustand, Jotai, Redux |
| Dado no F5 | sessionStorage próprio (`guardarCacheCliente`), lido como `initialData` vencido | Mantém o limite de 150 KB por resposta e não serializa o cache inteiro a cada mudança | `@tanstack/query-sync-storage-persister` |
| Prefetch | Só o resultado, com o ponteiro parado 120 ms ou com foco, nos links e nas regiões/zonas do mapa SVG (`onIntencao`) | Barato e com cache no servidor | Prefetch do mapa da UF (centenas de consultas ao TSE por UF) |
| Re-render no "ao vivo" | `memo` nos componentes pesados que não dependem do resultado (`Mapa`, `IndiceRegioes`, `SeletorMunicipio`, `Hemiciclo`) e props estáveis (`useCallback`/`useMemo` no `PainelMapa`) | Medido em /presidente/sp (645 municípios, demo, dev): cada evento do SSE custava ~110 ms de render (mapa ~40 ms, índice de links ~67 ms, seletor ~22 ms); caiu para ~30 ms, o que de fato mostra o resultado | Consultas dentro das features com `select`: o mapa e o resultado são lidos por vários blocos da tela (placar, lateral, ticker, faixa), então o App re-renderizaria igual; o custo estava nos filhos, não no App |
| Code splitting | `React.lazy` só na ficha e no hemiciclo | Aparecem sob interação ou abaixo do mapa | `BarraBusca` (fica no topo: carregar depois faria o layout pular) |

**Regras do TanStack Query neste projeto**

- Toda consulta nova entra em `api/consultas.ts` (recurso + URL = chave; `staleTime` explícito) e é lida com
  `useConsulta`; nada de `fetch` solto em componente (perde dedup, cache e a barra de carregamento).
- **Nunca `staleTime: Infinity`**: com ele o TanStack ignora a data do dado e não confirma nem o que veio do
  sessionStorage (a config de uma aba recarregada ficaria velha). Para "não muda na visita", use `VALE_SEMPRE_MS` (24 h).
- Sem `retry` automático (`providers.tsx`): quem repete é o polling ou o `incompleto`, no ritmo combinado com o
  servidor; repetir sozinho multiplicaria as consultas ao TSE quando ele estiver lento.
- `refetchIntervalInBackground: false` e `refetchOnWindowFocus: true`: aba oculta não faz polling; ao voltar, o
  que venceu é consultado na hora. O SSE fica aberto em segundo plano (é ele que mantém o "ao vivo").
- Quando o polling liga (ex.: 17h), o `useConsulta` consulta na hora o que venceu, sem esperar o primeiro ciclo.
- No dev, cada consulta aparece em dobro no Network (a primeira cancelada): é o StrictMode, não bug.

**Como acrescentar uma funcionalidade**

1. Pasta em `features/<nome>/` com os componentes e hooks dela.
2. Recurso novo da API: tipo da resposta em `compartilhado/api.d.mts`; no servidor, um arquivo em `server/rotas/` com
   o handler (`@returns` com o tipo) e a linha em `rotas/index.mjs`; decidir se a rota entra no `robots.txt` (ver
   "SEO"); no front, função em `consultas.ts`.
3. Consulta em `app/useDadosTela.ts`, componente ligado no `App.tsx` (ou num bloco de `app/`); regra pura em `dominio/`
   com teste. Se a feature precisar de algo de outra, suba esse algo para `ui/`/`lib/`.

**Componentes pesados e o "ao vivo"**: a cada evento do SSE o App renderiza de novo (o resultado mudou). Componente
com centenas de elementos que não depende do resultado leva `memo`, e quem o usa passa props estáveis (`useCallback`,
`useMemo`, objetos que vêm do cache do TanStack). Para conferir, envolva o bloco num `<Profiler>` do React e rode a
demo numa UF grande (/presidente/sp): o mapa não deve aparecer a cada evento.

**Próximos passos possíveis**: `memo` na coluna lateral (~12 ms por evento em dev; depende do placar, que muda a cada
evento — precisaria de um par estável só com número/nome/cor), o `strict` no servidor (trabalho à parte) e avaliar o
TanStack Router se as rotas crescerem.

### Estilo visual

Um único tema, "Plantão" (mesa de redação na noite da apuração), todo em `src/styles.css`: tokens em variáveis
CSS no `:root` com duas edições, diurna (clara) e noturna (escura, `prefers-color-scheme: dark` ou o botão do topo,
que grava `data-tema` no `<html>`). Archivo condensado (`font-stretch` 62–75%, 800, maiúsculas) nos títulos e
números grandes, IBM Plex Mono nos rótulos, abas, tabelas e horários, Archivo no corpo (servidas pelo próprio
site: `src/fontes.css`, arquivos dos pacotes Fontsource, só latin/latin-ext; sem preload, que no Lighthouse atrasava a
primeira pintura). Até elas chegarem, o texto usa 'Archivo Reserva'/'Plex Reserva' (fontes do sistema com
`size-adjust` e `ascent/descent-override` medidos), com uma face por `font-stretch` dos títulos (62/70/75%) e outra
só para algarismos: a troca de fonte não desloca a página. Fonte ou `font-stretch` novo: meça de novo (ver
`src/fontes.css`). Filetes finos, blocos invertidos para o que está ativo e **nenhum canto arredondado** (`--raio: 0`).
Cor forte fica reservada aos partidos; `--ao-vivo` (âmbar) só em status (ao vivo, encerrada, contagem), nunca em
dado. Evite verde-amarelo ou vermelho como cor de interface (são lidos como sinal político).

Cores de partido: as do `lib/util.ts` são a fonte; `useCores()` (`lib/tema.ts`) devolve `preench(cor)` (no escuro, L OKLCH ≥
0,62; o preto da UP vira a cor do texto) e `texto(cor)` (L ≥ 0,74 no escuro, ≤ 0,5 no claro). O SVG do mapa usa
cores prontas (hex), por isso a mistura com `--superficie` (intensidade pela vantagem: 40% abaixo de 10 pts, 70% até
20, cheia acima) é feita em TS com os tokens fixos `TOKENS` do `util.ts` — mudou um token no CSS, mude lá também.
As faixas (topo, aviso, status) ocupam a largura toda: cada filho direto de `.app` recebe o recuo da coluna central
(`--largura`, `--gutter`) como padding.

Marca: ícone da urna (fenda + três barras) em `ui/Logo.tsx`, ao lado de "Apuração.org" no topo, e o mesmo
desenho em `public/favicon.svg` (inverte em `prefers-color-scheme: dark`). PWA: `public/manifest.webmanifest`
(sem service worker) com PNGs 192/512, um maskable (desenho a 80%, dentro da zona segura) e `apple-touch-icon.png`;
mudou o desenho, mude os dois SVGs e rode `npm run icones`.

## SEO

- Rotas (`compartilhado/rotas.mjs`): `/`, `/<cargo>[/<uf>[/<mun>-<nome>[/zona-<zona>]]]` (cargo por slug: `governador`,
  `presidente-2-turno`…; município pelo código TSE, o nome é opcional) e `/candidato/<sq>-<nome>`. Links antigos
  `#/<cargoId>/…` viram o caminho novo no front (`replaceState`). Título da página por `tituloPagina()`, igual no
  servidor e no front.
- O servidor (`server/seo.mjs`) valida a rota (cargo visível pelas flags, UF do cargo, município, zona, candidato) e
  responde 200 com o `dist/index.html` preenchido nos marcadores `<!--seo-->…<!--/seo-->` e `<!--seo:conteudo-->`
  do `index.html` (não os remova), ou 404 + `noindex`. O `createRoot` substitui o resumo ao montar — esperado.
- Preload dos dados: o `index.html` já pede `/api/config` e o servidor acrescenta no `<head>` o `/api/resultado` da
  tela (`urlResultadoDoFront()` em `seo.mjs`), que começam junto com o JS. A URL tem de ser idêntica à do front
  (`urlResultado` em `src/api/cliente.ts`, mesmos parâmetros na mesma ordem); diferente, vira uma consulta a mais.
- **Nunca consultar o TSE para montar página**: o Googlebot pede dezenas de milhares de URLs. Usa só config,
  municípios, perfil e resultados do cache em memória ou do arquivo final (`getResultadoSemTse`), com prazo de
  300 ms (passou, descrição genérica). O índice de candidatos (cargo/UF/votos por `sq`) é montado uma vez por
  processo das eleições finais do arquivo (~1 s, ~80 MB).
- `robots.txt` bloqueia `/api/` menos as rotas baratas que o Google precisa para renderizar (`/api/config`,
  `/api/municipios`, `/api/resultado`, `/api/candidato/`); `/api/mapa` (1 consulta por município), busca, composição
  e SSE seguem bloqueados. Ao criar rota de API, decida se entra nessa lista.
- Sitemaps: `/sitemap.xml` (índice) → `sitemap-geral.xml`, um `sitemap-<cargo>.xml` por cargo (municípios) e
  `sitemap-candidatos.xml`; sem zonas e sem o 2º turno enquanto a flag pública estiver desligada; 1 h em memória.
- Cache: `/assets/*` `immutable` por 1 ano; HTML `no-cache`. Imagem de compartilhamento: `public/og.png` (1200×630),
  com `?v=<hash do arquivo>` na URL do `og:image` (as redes guardam a imagem pela URL; regerou, a URL muda sozinha).
- Nome do site: `NOME_SITE` (`Apuração.org`) em `seo.mjs`; o JSON-LD `WebSite` leva o nome antigo (`Apuração 2026`)
  em `alternateName`.

## Deploy no Render (instância Starter, US$ 7/mês)

`render.yaml` (Blueprint): Web Service Node, `npm ci && npm run build` / `npm start`, região virginia, plano
`starter` (512 MB, não dorme), health check em `/api/saude` (não passa pelo 301 do `SITE_URL`).
Publicado em **https://apuracao.org** (`www` redireciona para a raiz). O endereço do Render,
`https://apuracao-2026-kipe.onrender.com`, responde 301 para o domínio (`SITE_URL`), menos `/api/*`. Cada push na
branch principal do GitHub publica de novo depois que o CI passa (`.github/workflows/ci.yml`, `autoDeployTrigger:
checksPass`); um deploy ou mudança de variável reinicia o processo e esvazia o cache
em memória — normal, mas evite durante a apuração.

DNS na Cloudflare (registrador do domínio): CNAME `@` e `www` → `apuracao-2026-kipe.onrender.com` com o proxy
**desligado** ("DNS only" — com o proxy laranja o Render não verifica o domínio nem emite o certificado), mais o
TXT `google-site-verification` do Search Console (não apagar). Sitemap enviado ao Google Search Console e ao Bing
Webmaster Tools.

## API do TSE (descoberta empiricamente — não há documentação oficial)

Base: `https://resultados.tse.jus.br/oficial`

- Config geral: `/comum/config/ele-c.json` → pleitos do ciclo `ele2026`. 1º turno:
  eleição **6257** (federal: Presidente, cargo 1) e **6259** (estadual: Governador 3, Senador 5,
  Dep. Federal 6, Dep. Estadual 7, Dep. Distrital 8). `cdt2` aponta o 2º turno (6258 / 6260);
  `getConfig()` já o inclui automaticamente quando aparecer no `ele-c.json`.
- Municípios/zonas: `/ele2026/<ele>/config/mun-e<ele6>-cm.json` (`cd` = código TSE, `cdi` = IBGE,
  `z` = zonas). UF `zz` = exterior (sem código IBGE).
- Resultados (arquivo `-u.json`), `<ele6>` = eleição com 6 dígitos, `<c4>` = cargo com 4 dígitos:
  - BR: `/ele2026/<ele>/dados/br/br-c<c4>-e<ele6>-u.json` (só Presidente)
  - UF: `.../dados/<uf>/<uf>-c<c4>-e<ele6>-u.json`
  - Município: `.../dados/<uf>/<uf><mun>-c<c4>-e<ele6>-u.json`
  - Zona: `.../dados/<uf>/<uf><mun>-z<zona4>-c<c4>-e<ele6>-u.json`
- Abrangência (% seções por município, 1 arquivo por UF): `.../dados/<uf>/<uf>-e<ele6>-ab.json`
- Fotos: `/ele2026/<ele>/fotos/<uf|br>/<sqcand>.jpeg` (usadas direto no `<img>`, sem proxy)
- Campos úteis do `-u.json`: `s.ts/st/pst` seções total/totalizadas/%; `e.te/c/a` eleitorado,
  comparecimento, abstenção; `v.vv/vb/tvn` válidos/brancos/nulos; `carg[0].agr[].par[].cand[]`
  com `n` (número), `nmu` (nome de urna), `vap`/`pvap` (votos/%), `e` (eleito `s`/`n`), `st` (situação).
  Números vêm como string; percentuais com vírgula decimal.
- Situação do candidato: use o texto `st`, NÃO só o `e` — quem vai ao 2º turno também vem com `e = "s"`.
  Valores vistos (2024): majoritário "Eleito" / "2º turno" / "Não eleito"; proporcional "Eleito por QP" /
  "Eleito por média" / "Suplente" / "Não eleito"; vazio = indefinido. `classificar()` em `tse/apuracao.mjs` vira
  `status` + `detalhe`. `dvt` = destino dos votos: "Válido", "Válido (legenda)", "Anulado", "Anulado sub judice".
- Campos de progresso: `e.esnt` = eleitores em seções ainda não totalizadas (teto de votos que faltam),
  `v.vansj` = votos anulados sub judice; no proporcional, `par[].tvtn`/`tvtl` = votos nominais/legenda e
  `agr[].vag` = vagas projetadas pelo TSE (não garantidas).
- "Matematicamente eleito" / "2º turno garantido" (`matematicamente`, `situacaoMatematica()` em `tse/apuracao.mjs`): calculado só
  no arquivo da disputa (BR p/ Presidente, UF p/ os demais); município/zona/UF do Presidente copiam do
  arquivo da disputa em `getResultado`. Pior caso: todo eleitor que falta vota contra; sub judice conta
  como válido para os rivais; no proporcional só a vaga por QP (sobras fora). 2º turno garantido (executivo):
  ninguém mais alcança a maioria e os 2 rivais mais próximos, juntos, precisariam de mais votos do que
  faltam. Os selos somem quando o TSE marca `st` (eleito / 2º turno).
- Suplência e efeito puxador (`chapa`, `chapas()` em `tse/apuracao.mjs`, só proporcional, no arquivo da UF e copiado para
  município/zona): puxado = eleito com menos votos que o QE (`carg.qe`) numa chapa (partido isolado ou federação)
  em que alguém passou do QE. Com `st` oficial usa eleitos/suplentes do TSE; antes, projeta pelas vagas de cada
  chapa (`agr.vag`) e o front marca "(projeção)" e só mostra os 5 primeiros suplentes de cada chapa.
- Não existe arquivo agregado "vencedor por município": o mapa estadual faz 1 requisição por
  município (SP = 645), com concorrência limitada (`mapLimit`) e cache de 60 s. Por isso, cargos
  proporcionais (arquivos de centenas de KB) usam só o `-ab.json` no mapa estadual.
- Zonas eleitorais **não têm malha geográfica pública**: o contorno no mapa é estimado (ver "Zonas no mapa").

## Malhas do IBGE (`dados/malhas/`)

O mapa desenha as malhas do IBGE (Brasil por UF, qualidade mínima; cada UF por município, intermediária), versionadas
em `dados/malhas/<br|uf>.json.gz` (~3 MB, propriedades já trocadas por `uf`/`ibge`). O disco do Render é apagado a
cada reinício e deploy: em 15/10/2026 o serviço reiniciou, o IBGE estava inacessível e o mapa ficou fora do ar —
por isso o servidor não depende mais dele.
- Ordem de leitura (`lerMalha()` em `server/malhas.mjs`): `dados/malhas`, senão `.cache/geo/<alvo>.json`, senão o
  IBGE (gravado em `.cache/geo`). No servidor, cada malha fica em memória após o 1º pedido; uma falha do IBGE só
  é tentada de novo após 30 s. O front mostra "Mapa indisponível · tentando de novo" e repete a cada 15 s.
- Certificado: desde outubro de 2026 o `servicodados.ibge.gov.br` não envia a CA intermediária (Sectigo Public Server
  Authentication CA DV R36). O navegador completa a cadeia; o Node falha com `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. A
  intermediária fica em `server/certs/sectigo-dv-r36.pem` (válida até 2036) e vai junto das raízes do Node só nas
  consultas ao IBGE. Se o IBGE trocar de emissor, baixe a nova pelo `CA Issuers` do certificado
  (`openssl x509 -noout -ext authorityInfoAccess`).
- `npm run malhas` (opções `--uf sp,rj`, `--br`, `--forcar` para baixar do IBGE em vez de usar `.cache/geo`):
  rode antes de outra eleição e faça commit. Mudou uma malha, rode também `npm run zonas` (o contorno das zonas é
  recortado por ela).

## Zonas no mapa (contorno estimado)

O TSE não publica limites das zonas. `npm run zonas` (opção `--uf sp,rj`; ~15 s para o Brasil) monta um contorno
aproximado para os ~190 municípios com mais de uma zona (725 zonas; nos demais a zona é o município inteiro):
- Locais de votação com latitude/longitude dos Dados Abertos (`eleitorado_local_votacao_<ano>.zip`, ~176 MB, guardado
  em `.cache/dados-abertos`; apague o zip para baixar a versão nova). Eleitores por local = soma das seções.
- Divisão simples (Voronoi): cada ponto do município fica com a zona do local mais próximo (distância em coordenadas
  planas, lon·cos(lat)); as células da mesma zona são juntadas e recortadas pelo contorno do município — a mesma
  malha do IBGE do mapa (`dados/malhas/<uf>.json.gz`), para os limites baterem. Locais no mesmo ponto ficam com a zona de
  mais eleitores; local a mais de 1 km fora do município é descartado (o script avisa).
- Dependências só do script (devDependencies): `d3-delaunay` e `polygon-clipping`. O servidor só lê o `.json.gz`
  (`{ gerado, municipios: { <cd TSE>: { <zona4>: MultiPolygon } } }`), em memória no 1º pedido.
- Front: com o município aberto, `app/useDadosTela.ts` pede `/api/zonas?uf=<uf>&mun=<mun>` (404 = sem contorno;
  ETag + `no-cache` como as demais rotas, para uma regeração chegar no deploy) e o `Mapa` pinta as
  zonas sobre o município (mesmas cores/modos, tooltip, clique abre a zona; a zona aberta é enquadrada e as outras
  atenuadas, como o município); a lista de zonas continua abaixo. Uma
  nota sob o mapa avisa que os limites são estimados. Parques, represas e área rural também ficam com alguma zona
  (ex.: o extremo sul de SP vira uma zona enorme) — limitação aceita da divisão simples.
- Rode de novo quando o TSE atualizar o cadastro de locais (antes de outra eleição) e faça commit.

## 2º turno

- Navegação: com os dois turnos na config, uma barra "1º turno / 2º turno" fica entre a busca e os cargos; a
  barra de cargos mostra só os do turno escolhido. Trocar de turno mantém o cargo (e a UF) se ele existir no outro.
- `getConfig()` liga o 2º turno ao 1º pelo `cdt2` (`primeiroTurno` no cargo). No `/api/mapa` do 2º turno cada
  região traz também o 2º colocado (`segundo`) e `virou` (quem lidera ficou atrás do rival no 1º turno, lido do
  arquivo próprio do 1º turno, sem consultar o TSE).
- Mapa do 2º turno: cor do finalista clara = liderando (apuração < 100%), sólida = venceu, hachurada = virou;
  siglas das UFs no mapa do Brasil; cartão do exterior. Cores dos finalistas: as dos partidos, salvo quando têm
  a mesma matiz (`coresDuelo()` em `util.ts` troca a do segundo por uma reserva).

### Liberar o 2º turno em produção

O 2º turno fica escondido pela feature toggle `segundoTurno` e **liga sozinho em 25/10/2026 às 00h** (horário de
Brasília). Nada precisa ser feito para isso; os passos abaixo servem para conferir antes, liberar antes da hora ou
segurar se algo der errado. `URL` = https://apuracao.org.

1. **Antes de 25/10**
   - Defina `ADMIN_TOKEN` no Render (serviço *apuracao-2026* → **Environment**).
   - Confirme que `SIMULACAO_2TURNO` **não** está definida (ela troca os dados do TSE pela simulação com os votos de 2022).
   - `curl -H "Authorization: Bearer $ADMIN_TOKEN" "$URL/api/flags"`: `segundoTurno` deve estar com o padrão.
2. **Conferir antes de liberar**: quando o TSE publicar o 2º turno (dias antes da votação), abra
   `$URL/api/preview?token=<ADMIN_TOKEN>`. Só esse navegador vê o 2º turno (selo "PRÉVIA · sair"); os números
   estarão zerados até as 17h do dia 25. Para sair: `$URL/api/preview?sair`.
3. **Liberar antes da hora** (sem reiniciar; vale até o próximo reinício do serviço):
   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$URL/api/flags?segundoTurno=on"
   ```
   Para valer de vez, defina `FLAG_SEGUNDO_TURNO=on` no Render — isso reinicia o serviço e esvazia o cache.
4. **Segurar** (esconder de novo): o mesmo comando com `segundoTurno=off`, ou `FLAG_SEGUNDO_TURNO=off` no Render.
   `segundoTurno=padrao` volta à data de 25/10.
5. **Nunca** deixe `SIMULACAO_2TURNO=1` em produção a partir de 25/10.

Evite mudar variáveis no Render durante a apuração: cada mudança reinicia o serviço e esvazia o cache.

### Dia do 2º turno (25/10/2026) e depois

Valem as mesmas regras do 1º turno, que são por cargo/eleição (nada a configurar além das flags):
- até 8h: faixa "a votação do 2º turno ainda não começou"; 8h–17h: "votação em andamento" com contagem regressiva.
  Até 17h cada arquivo do TSE é buscado no máximo uma vez (os candidatos e os zeros) e guardado até o fechamento;
  o front não abre "ao vivo" nem polling (`fimDaVotacao`, `apuracaoAberta`).
- 17h: o "ao vivo" liga sozinho; com 100% das seções em todas as UFs da eleição (`br-e006258-ab.json` /
  `br-e006260-ab.json`), `encerrada` desliga a consulta ativa daquela eleição.
- No 2º turno só existe o selo "matematicamente eleito" (maioria absoluta); "2º turno garantido" é só do 1º turno.
- No dia seguinte (ou quando o `manifesto.json` ficar todo final): `npm run arquivar -- --turno 2` grava
  `arquivo/ele2026-2turno/`; depois do commit e do deploy, 6258/6260 saem só do arquivo (`eleicaoFinal`), sem
  consultar o TSE. O script recusa rodar com `SIMULACAO_2TURNO=1`.

### Simulação do 2º turno (`simulacao/`)

Enquanto o TSE não publica o 2º turno, `npm run simular-2turno` monta um a partir dos CSVs dos Dados Abertos do 2º
turno de 2022 (`detalhe_votacao_munzona` e `votacao_partido_munzona`; a API de resultados não tem mais 2022): em
cada zona de 2026, eleitorado e seções do 1º turno de 2026 e as taxas (comparecimento, brancos, nulos, divisão dos
válidos) da mesma zona em 2022 — ou do município/UF se a zona é nova. Município, UF e Brasil somam as zonas.
Os finalistas vêm do `st` do 1º turno; quem herda cada votação de 2022 está nas tabelas `PRESIDENTE`/`GOVERNADOR`
do script (AM e ES usam o governador de 2022; as demais UFs, o Presidente de 2022 na UF). O script falha se os
finalistas do arquivo não baterem com as tabelas.

Com `SIMULACAO_2TURNO=1` o servidor acrescenta o pleito de `simulacao.json` ao ele-c.json (eleições 6258/6260, os
códigos que o TSE vai usar) e serve essas eleições só da pasta (como eleição final do arquivo), fotos do 1º turno,
sem aviso de horário. A interface mostra o selo "SIMULAÇÃO" e uma nota. **Quando o TSE publicar o 2º turno,
desligue a variável** (ligada, a simulação continua no lugar das eleições do TSE); confira então se o formato real
bate com o simulado. `DEMO=1` junto da simulação mostra a apuração avançando sobre os votos simulados.

## Dados Abertos do TSE (perfil e bens dos candidatos)

O arquivo de resultados só traz nome, número, nascimento, partido, vices e votos. O resto vem dos CSVs em
`https://cdn.tse.jus.br/estatistica/sead/odsele/<conjunto>/<conjunto>_2026.zip` (`consulta_cand`,
`consulta_cand_complementar`, `bem_candidato`; o `*_BRASIL.csv` reúne todas as UFs). Latin1, separador `;`,
campos vazios como `#NULO`/`#NE`. A chave `SQ_CANDIDATO` é o `sqcand` dos resultados. Os CSVs trazem **CPF,
título de eleitor e e-mail: nunca incluir** no arquivo gerado. O TSE atualiza os CSVs (situação do registro,
bens); rode `npm run candidatos` de novo e faça commit. A API DivulgaCandContas responde 403 (Akamai) a robôs.

## Arquivo próprio dos resultados (`arquivo/`)

O TSE promete manter os arquivos no ar até `dtlim` (04/10/2034), mas guardamos uma cópia. `npm run arquivar`
(opções `--turno 1`, `--uf sp,mg`, `--cargo 6,7`, `--forcar`, `--rps 8`, `--conc 8`) baixa Brasil, UFs,
municípios e zonas de todos os cargos (~59 mil arquivos, ~2 h a 8 consultas/s) e grava em
`arquivo/ele2026-1turno/`: `ele-c.json`, `manifesto.json` e, por eleição, `mun-cm.json.gz`, `<uf>-ab.json.gz` (inclusive `br`) e
uma unidade `<uf>-c<cargo4>.json.gz` por cargo e UF (Presidente também tem `br`), com uma cópia só do JSON da UF
em `<uf>-c<cargo4>-uf.json.gz` (a busca lê as ~140 UFs; abrir as unidades inteiras passava dos 512 MB do Render).

- Formato (`server/arquivo.mjs`): a unidade guarda o JSON da UF exatamente como veio (`modelo`) e, por
  município/zona (chave = abrangência da URL, ex. `sp71072-z0001`), só o que muda: `vap` por candidato
  (na ordem do modelo), diferenças de agremiação/partido, os blocos `s`/`e`/`v` como listas e as exceções do
  `pvap`. `pvapn` é descartado. O TSE ordena agremiações e candidatos de um jeito em cada região;
  a remontagem segue o modelo.
- O script confere cada região: o JSON remontado tem que ser igual ao original (sem ordem e sem `pvapn`);
  se não for, a unidade falha e não é gravada.
- Retomável: unidade final (`tf = "s"` na UF e em todas as regiões) é pulada; rode de novo até o
  `manifesto.json` não ter mais unidade com `final: false` (deputados podem levar dias por recursos/sub judice).
  O gzip não guarda data, então unidade sem mudança não gera diff no git.
- No servidor (`fetchJson`): eleição com **todas as unidades `final: true` no manifesto** (`eleicaoFinal()`)
  sai só do arquivo, sem consultar o TSE e sem precisar de variável — o resultado não muda mais. Fora isso,
  o arquivo entra quando o TSE falha, está pausado ou responde 404/403, e o TSE
  é tentado de novo após 60 s; com `ARQUIVO=1` é a fonte única do que cobre, menos o `ele-c.json` (sempre do
  TSE, para o 2º turno aparecer; o arquivado só se o TSE falhar). O 2º turno usa outros códigos de eleição
  (6258/6260), que o arquivo do 1º turno não cobre: vem do TSE mesmo com `ARQUIVO=1`. `/api/saude` mostra `arquivo`.
  Fotos dos candidatos e malhas do IBGE não fazem parte do arquivo.

## Convenções e cuidados

- Deslocamento de layout (CLS): o que chega depois não pode empurrar a tela. Enquanto o dado não vem, guarde o
  lugar com a mesma altura/largura: `EsqueletoPlacar` (mesmas classes do `Placar`, barras com altura `1lh`), os
  itens da faixa de status, o seletor de município desativado, "—" nas contagens do subtítulo e do placar. Meça com
  o Lighthouse sobre o build (`npm run build`, `ARQUIVO=1 PORT=3099 node server/index.mjs`) e, no celular,
  `--throttling-method=devtools` (a simulação padrão exagera o LCP em localhost). Em out/2026: início 75→96
  (desktop) e 76→98 (celular), CLS de 0,44–0,64 para menos de 0,02.

- Antes da apuração (até 17h de Brasília no dia da eleição) os arquivos existem com votos zerados —
  use `npm run demo` para desenvolver a interface. Horário de votação é unificado (8h–17h de Brasília);
  `getConfig()` envia `abertura`/`encerramento` por cargo e o front mostra o `AvisoVotacao`
  (desligado no modo demo, a menos que `ENCERRAMENTO` seja definido).
- Cadência: com "ao vivo" ligado (padrão), resultados chegam pelo SSE (`AO_VIVO_MS`, 5 s, no servidor) e o
  mapa é consultado a cada 30 s; desligado, resultados a cada 30 s e mapa a cada 60 s (`ATUALIZA_*_MS` em `apuracao/useFaseApuracao.ts`);
  o servidor guarda cache de 20 s (UF/BR), 45 s (zonas) e 60 s (municípios). O TSE não tem intervalo
  fixo — publica conforme as urnas são totalizadas. Se mudar os intervalos, os avisos se ajustam sozinhos.
- O Akamai do TSE guarda cada arquivo por ~60 s (`cache-control: max-age` com o tempo que falta, fase
  própria por arquivo): o cache do servidor vale no mínimo até lá (`vale()` em `tse/cache.mjs`), então o "ao vivo"
  de 5 s vai ao TSE ~1x por minuto por arquivo. Vencido, a consulta é condicional (`If-None-Match` → 304 sem
  corpo). O resultado normalizado fica junto do JSON no cache (`deRaw`) e só é refeito quando o JSON muda.
- Mapas: região com 100% das seções totalizadas renova a cada 30 min (`ttlCompletoMs`), já que o líder não
  muda mais. A fila baixa (municípios, zonas, busca) atende o pedido mais recente primeiro e um pedido
  repetido volta para o fim; o que ninguém pede mais afunda e é descartado quando a fila enche.
- Antes do fechamento das urnas (17h de Brasília) o TSE não divulga nada (nem o exterior): o servidor busca
  cada arquivo de resultado no máximo uma vez e guarda até o fechamento (`fimDaVotacao` + `validoAte` no
  `fetchJson`), e o front não abre "ao vivo" nem polling (`apuracaoAberta` em `useFaseApuracao`); às 17h liga sozinho
  e o que venceu é consultado na hora.
- Apuração encerrada: `/api/config` marca `encerrada` por cargo quando o `br-e<ele6>-ab.json` (1 arquivo por
  eleição, % de seções por UF) mostra 100% em todas as UFs (`apuracaoEncerrada()` em `tse.mjs`, cache de 5 min).
  O front então não abre "ao vivo" nem polling: busca ao abrir a página e ao navegar (o que já veio vale 5 min),
  e só repete (`RETENTAR_MS`, 15 s, parâmetro `incompleto` do `useConsulta`) enquanto o mapa vier com regiões
  faltando ou a consulta falhar. A config é lida uma vez: aba aberta durante a apuração segue "ao vivo" até recarregar.
- Cache do cliente (TanStack Query, via `useConsulta` em `src/api/`): toda consulta nova entra em
  `api/consultas.ts` (URL + `staleTime`) e é lida com `useConsulta`, nunca com `fetch` solto, para ganhar a dedup
  e o cache. Ao trocar de tela, o último dado daquela URL aparece na hora (atenuado, "atualizando") e só é
  consultado de novo se venceu (20 s na apuração, 5 min antes das 17h ou com ela encerrada); URL nunca vista volta
  ao esqueleto. Espelhado no sessionStorage (respostas até 150 KB) para o F5, descartado após 30 min; o dado de
  lá conta como vencido e é confirmado ao abrir. Aba oculta não faz polling; ao voltar, o vencido é consultado.
  Não use `staleTime: Infinity` (o TanStack não consultaria nem o dado vindo do storage). As respostas 200 da API
  levam ETag + `no-cache` (304 se não mudou).
- Seja educado com o TSE: mantenha cache/TTL e limites de concorrência ao adicionar chamadas.
  Os TTLs ficam em `getResultado(params, ttlMs)` e `fetchJson`.
- A projeção do mapa é plana de propósito (ver comentário em `Mapa.tsx`): as malhas do IBGE não seguem
  a orientação de anéis que as projeções esféricas do d3 exigem.
- Testes em `testes/` (`npm test`, `node:test` sem dependências; o CI do GitHub roda typecheck, testes e build):
  - `testes/servidor/normalizar.test.mjs`: resultados reais do `arquivo/` passados pelo `normalizar()`, congelados em
    `.snapshot` (inclusive uma apuração "em andamento" simulada sobre eles, para a projeção das chapas e o
    "matematicamente"). Mudou o normalizar de propósito: `npm run test:atualizar` e revise o diff do snapshot.
  - `testes/servidor/apuracao.test.mjs`: regras de maioria, 2º turno garantido, Senado, QE e `classificar`, com
    resultados montados à mão.
  - `testes/servidor/fonte.test.mjs`: `fetchJson` com o `fetch` simulado (dedup, cache, 304, 404, pausa após 429).
  - `testes/front/`: módulos `.ts` puros do front (rotas, `resolverTela`, `util`), importados sem build pelo
    `testes/ts.mjs` (o Node remove os tipos; o hook só completa a extensão). `.tsx` não roda no Node: lógica
    testável fica em `.ts`.
  - Interface: valide com `npm run typecheck` e abrindo o app em modo demo.
