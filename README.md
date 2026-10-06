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

## 2º turno em produção

O 2º turno fica escondido pela feature toggle `segundoTurno` e **liga sozinho em 25/10/2026 às 00h** (horário de
Brasília). Nada precisa ser feito para isso; os passos abaixo servem para conferir antes, liberar antes da hora ou
segurar se algo der errado. `URL` = https://apuracao-2026-kipe.onrender.com.

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

Evite mudar variáveis no Render durante a apuração: cada mudança reinicia o serviço e esvazia o cache. No dia
seguinte à votação, os resultados finais são arquivados com `npm run arquivar -- --turno 2` (ver [CLAUDE.md](CLAUDE.md)).

Fontes: [TSE – Resultados](https://resultados.tse.jus.br) · [IBGE – Malhas](https://servicodados.ibge.gov.br/api/docs/malhas).
Projeto independente, sem vínculo com o TSE. Detalhes técnicos em [CLAUDE.md](CLAUDE.md).
