# Apuração 2026

Acompanhe a apuração das Eleições 2026 em tempo real com os dados oficiais do TSE.

- **Mapa interativo**: clique num estado para ver os candidatos, depois num município e, por fim, numa zona eleitoral
- **Busca** por nome ou número de candidato, com filtros por cargo e UF, mostrando a quantidade de votos
- Todos os cargos: Presidente, Governador, Senador, Deputado Federal, Deputado Estadual e Deputado Distrital (o 2º turno aparece automaticamente)
- Votos no exterior, % de seções apuradas, comparecimento, brancos e nulos
- Atualização automática (30 s para resultados, 60 s para o mapa) e link compartilhável (a URL guarda a navegação)

```bash
npm install
npm run dev     # http://localhost:5173
npm run demo    # mesmo app, com votos simulados (antes de as urnas fecharem)
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | API (porta 3001) + Vite (porta 5173) |
| `npm run demo` | igual ao `dev`, com votos sintéticos sobre os candidatos reais |
| `npm run dev:2turno` | `dev` com a simulação do 2º turno ligada |
| `npm run typecheck` | confere os tipos do TypeScript |
| `npm run build` | confere os tipos e gera o build de produção em `dist/` |
| `npm start` | produção: o servidor Node serve `dist/` e a API na porta 3001 |
| `npm run candidatos` | regera o perfil e os bens dos candidatos (Dados Abertos do TSE) |
| `npm run arquivar` | guarda os resultados finais em `arquivo/` (opções `--turno`, `--uf`, `--cargo`, `--forcar`) |
| `npm run simular-2turno` | regera a simulação do 2º turno em `simulacao/`, com os votos de 2022 |
| `npm run zonas` | regera o contorno estimado das zonas eleitorais no mapa |
| `npm run icones` | regera os ícones PNG do PWA a partir dos SVGs em `public/` (precisa do `rsvg-convert`) |
| `npm run og` | regera a imagem de compartilhamento `public/og.png` a partir de `server/scripts/og.html` (precisa do `chromium`) |

Fontes: [TSE – Resultados](https://resultados.tse.jus.br) · [IBGE – Malhas](https://servicodados.ibge.gov.br/api/docs/malhas).
Projeto independente, sem vínculo com o TSE. Detalhes técnicos em [CLAUDE.md](CLAUDE.md).
