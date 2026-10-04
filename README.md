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

Fontes: [TSE – Resultados](https://resultados.tse.jus.br) · [IBGE – Malhas](https://servicodados.ibge.gov.br/api/docs/malhas).
Projeto independente, sem vínculo com o TSE. Detalhes técnicos em [CLAUDE.md](CLAUDE.md).
