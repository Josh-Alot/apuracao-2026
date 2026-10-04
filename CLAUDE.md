# Apuração 2026 — CLAUDE.md

App web para acompanhar a apuração das Eleições Gerais 2026 (1º turno em 04/10/2026) com dados
oficiais do TSE: mapa interativo com funil **Brasil → UF → município → zona eleitoral** e busca de
candidatos por nome/número.

Idioma do projeto: **português** (código, UI, comentários e commits).

## Comandos

```bash
npm install
npm run dev        # API (porta 3001) + Vite (porta 5173, proxy /api → 3001)
npm run demo       # igual ao dev, mas com votos sintéticos (DEMO=1) — útil antes das 17h de Brasília
npm run typecheck
npm run candidatos # regera dados/candidatos-2026.tsv.gz (perfil e bens, Dados Abertos do TSE)
npm run build && npm start   # produção: o servidor Node serve dist/ e /api na porta 3001
```

Variáveis de ambiente do servidor: `PORT` (3001), `DEMO=1`, `DEMO_MINUTOS` (15; tempo até a demo
chegar a 100%), `AO_VIVO_MS` (5000; verificação do TSE no modo ao vivo), `CICLO` (`ele2026`; trocar para testar com outro ciclo), `ENCERRAMENTO` (ISO 8601;
sobrescreve o fechamento das urnas para testar o aviso, ex. `ENCERRAMENTO=2026-10-04T13:00:00-03:00`).

## Arquitetura

```
server/            Node puro (ESM, sem dependências) — o TSE não envia CORS, então tudo passa aqui
  index.mjs        Rotas HTTP, busca, malhas do IBGE (cache em disco em .cache/geo), arquivos estáticos
  aovivo.mjs       Stream SSE /api/ao-vivo: 1 vigia por resultado consulta o TSE a cada 5 s e empurra só quando muda
  tse.mjs          Cliente TSE: URLs, cache em memória c/ dedup, normalização dos JSONs
  demo.mjs         Gera votos determinísticos sobre os arquivos reais (candidatos reais)
  candidatos.mjs   /api/candidato/:sq — perfil e bens; lê dados/candidatos-2026.tsv.gz no 1º pedido (buffer + índice)
  scripts/candidatos.mjs  `npm run candidatos`: baixa os CSVs dos Dados Abertos e gera o .tsv.gz
dados/             Arquivos gerados e versionados (candidatos-2026.tsv.gz)
src/               React 19 + TypeScript + Vite; d3-geo só para gerar os paths SVG
  App.tsx          Estado da navegação (no hash da URL), polling e composição das telas
  api.ts           useApi(url, intervalo) — fetch + polling mantendo o dado anterior
  components/
    Mapa.tsx           Choropleth SVG (projeção plana própria), tooltip, legenda, zoom no município;
                       zoom/arraste do leitor (roda, arrastar, pinça, botões +/−/Ajustar) via viewBox
    PainelResultado.tsx Totais, % apurado, lista de candidatos com filtro local
    ModalCandidato.tsx Ficha do candidato (<dialog>): resultado + perfil, candidatura e bens declarados
    BarraBusca.tsx     Busca global (debounce 300 ms) com filtros de cargo/UF
    ListaRegioes.tsx   Lista clicável para regiões sem malha (zonas, cidades no exterior, UFs)
    Carregando.tsx     Barra fina no topo (conta requisições ativas em getJson) + esqueletos de página/painel/mapa
    AvisoVotacao.tsx   Faixa "votação ainda não começou / em andamento (contagem regressiva) / urnas fechadas"
    ProximaAtualizacao.tsx "a cada 30 s · próxima em 12 s" (usa `proxima` exposto pelo useApi)
    Num.tsx            Número ao vivo: conta do valor antigo ao novo e realça ao mudar; pulsa sob `.atualizando`
  util.ts          Formatação pt-BR, nomes das UFs, cores dos partidos
  styles.css       Estilo único ("jornal") — tokens em variáveis CSS no :root
```

### Estilo visual

Um único tema, "jornal", todo em `src/styles.css`: tokens em variáveis CSS no `:root` (com versão escura
"edição noturna" em `prefers-color-scheme: dark`), Fraunces nos títulos e Libre Franklin no corpo via
Google Fonts (`index.html`), papel creme, filetes em vez de cartões, os 2 primeiros colocados como "manchete".
Cor forte fica reservada aos partidos; evite verde-amarelo ou vermelho como cor de interface (são lidos
como sinal político).

## Deploy no Render (plano gratuito — o que está em uso)

`render.yaml` (Blueprint): Web Service Node, `npm ci && npm run build` / `npm start`, região virginia.
Publicado em `https://apuracao-2026.onrender.com` (ou com sufixo, se o nome já existir). Cada push na
branch principal do GitHub publica de novo. O plano gratuito dorme após 15 min sem acesso (~1 min para
acordar) e reinicia o processo, perdendo o cache em memória — normal.

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
  "Eleito por média" / "Suplente" / "Não eleito"; vazio = indefinido. `classificar()` em `tse.mjs` vira
  `status` + `detalhe`. `dvt` = destino dos votos: "Válido", "Válido (legenda)", "Anulado", "Anulado sub judice".
- Não existe arquivo agregado "vencedor por município": o mapa estadual faz 1 requisição por
  município (SP = 645), com concorrência limitada (`mapLimit`) e cache de 60 s. Por isso, cargos
  proporcionais (arquivos de centenas de KB) usam só o `-ab.json` no mapa estadual.
- Zonas eleitorais **não têm malha geográfica pública**; por isso aparecem como lista, não no mapa.

## Dados Abertos do TSE (perfil e bens dos candidatos)

O arquivo de resultados só traz nome, número, nascimento, partido, vices e votos. O resto vem dos CSVs em
`https://cdn.tse.jus.br/estatistica/sead/odsele/<conjunto>/<conjunto>_2026.zip` (`consulta_cand`,
`consulta_cand_complementar`, `bem_candidato`; o `*_BRASIL.csv` reúne todas as UFs). Latin1, separador `;`,
campos vazios como `#NULO`/`#NE`. A chave `SQ_CANDIDATO` é o `sqcand` dos resultados. Os CSVs trazem **CPF,
título de eleitor e e-mail: nunca incluir** no arquivo gerado. O TSE atualiza os CSVs (situação do registro,
bens); rode `npm run candidatos` de novo e faça commit. A API DivulgaCandContas responde 403 (Akamai) a robôs.

## Convenções e cuidados

- Antes da apuração (até 17h de Brasília no dia da eleição) os arquivos existem com votos zerados —
  use `npm run demo` para desenvolver a interface. Horário de votação é unificado (8h–17h de Brasília);
  `getConfig()` envia `abertura`/`encerramento` por cargo e o front mostra o `AvisoVotacao`
  (desligado no modo demo, a menos que `ENCERRAMENTO` seja definido).
- Cadência: com "ao vivo" ligado (padrão), resultados chegam pelo SSE (`AO_VIVO_MS`, 5 s, no servidor) e o
  mapa é consultado a cada 30 s; desligado, resultados a cada 30 s e mapa a cada 60 s (`ATUALIZA_*_MS` em `App.tsx`);
  o servidor guarda cache de 20 s (UF/BR), 45 s (zonas) e 60 s (municípios). O TSE não tem intervalo
  fixo — publica conforme as urnas são totalizadas. Se mudar os intervalos, os avisos se ajustam sozinhos.
- Antes do fechamento das urnas (17h de Brasília) o TSE não divulga nada (nem o exterior): o servidor busca
  cada arquivo de resultado no máximo uma vez e guarda até o fechamento (`fimDaVotacao` + `validoAte` no
  `fetchJson`), e o front não abre "ao vivo" nem polling (`apuracaoAberta` no `App.tsx`); às 17h liga sozinho.
- Seja educado com o TSE: mantenha cache/TTL e limites de concorrência ao adicionar chamadas.
  Os TTLs ficam em `getResultado(params, ttlMs)` e `fetchJson`.
- A projeção do mapa é plana de propósito (ver comentário em `Mapa.tsx`): as malhas do IBGE não seguem
  a orientação de anéis que as projeções esféricas do d3 exigem.
- Não há testes automatizados ainda; valide com `npm run typecheck` e abrindo o app em modo demo.
