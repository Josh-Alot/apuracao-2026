// Gera dados/candidatos-2026.tsv.gz a partir dos CSVs do Portal de Dados Abertos do TSE
// (perfil do candidato, dados complementares e bens declarados). Rodar com `npm run candidatos`
// sempre que o TSE atualizar os arquivos. Usa o `unzip` do sistema (só roda na máquina de quem publica).
//
// CPF, título de eleitor e e-mail vêm nos CSVs mas ficam de fora de propósito.

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ANO = 2026;
const CACHE = path.join(ROOT, '.cache', 'dados-abertos');
const SAIDA = path.join(ROOT, 'dados', `candidatos-${ANO}.tsv.gz`);
const CDN = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
const CONJUNTOS = ['consulta_cand', 'consulta_cand_complementar', 'bem_candidato'];

async function baixar(nome) {
  const zip = path.join(CACHE, `${nome}_${ANO}.zip`);
  const res = await fetch(`${CDN}/${nome}/${nome}_${ANO}.zip`);
  if (!res.ok) throw new Error(`${nome}: HTTP ${res.status}`);
  await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()));
  const csv = `${nome}_${ANO}_BRASIL.csv`; // reúne todas as UFs
  execFileSync('unzip', ['-oq', zip, csv, '-d', CACHE]);
  return lerCsv(await fs.readFile(path.join(CACHE, csv)));
}

/** CSV do TSE: latin1, separador ";", todos os campos entre aspas. */
function lerCsv(buf) {
  const texto = new TextDecoder('latin1').decode(buf);
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ';') { linha.push(campo); campo = ''; }
    else if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (ch !== '\r') campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas;
  return resto.map((l) => Object.fromEntries(cab.map((k, i) => [k, l[i]])));
}

/** Campo vazio no TSE: "#NULO", "#NE", "NÃO DIVULGÁVEL" etc. */
const val = (s) => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return !v || v.startsWith('#') || /^n[aã]o divulg[aá]vel$/i.test(v) ? null : v;
};
const num = (s) => {
  const v = val(s);
  if (v == null) return null;
  // Bens vêm como "46000,00"; o teto de gastos, como "88944030.8".
  const n = Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

await fs.mkdir(CACHE, { recursive: true });
const [cand, compl, bens] = await Promise.all(CONJUNTOS.map(baixar));

const candidatos = {};
for (const c of cand) {
  candidatos[c.SQ_CANDIDATO] = {
    nomeSocial: val(c.NM_SOCIAL_CANDIDATO),
    nascimento: val(c.DT_NASCIMENTO),
    ufNasc: val(c.SG_UF_NASCIMENTO),
    genero: val(c.DS_GENERO),
    instrucao: val(c.DS_GRAU_INSTRUCAO),
    estadoCivil: val(c.DS_ESTADO_CIVIL),
    corRaca: val(c.DS_COR_RACA),
    ocupacao: val(c.DS_OCUPACAO),
    partidoNome: val(c.NM_PARTIDO),
    federacao: val(c.NM_FEDERACAO),
    composicaoFederacao: val(c.DS_COMPOSICAO_FEDERACAO),
    coligacao: c.TP_AGREMIACAO === 'COLIGAÇÃO' ? val(c.NM_COLIGACAO) : null,
    composicaoColigacao: c.TP_AGREMIACAO === 'COLIGAÇÃO' ? val(c.DS_COMPOSICAO_COLIGACAO) : null,
    bens: [],
    totalBens: 0,
  };
}
for (const c of compl) {
  const d = candidatos[c.SQ_CANDIDATO];
  if (!d) continue;
  Object.assign(d, {
    munNasc: val(c.NM_MUNICIPIO_NASCIMENTO),
    nacionalidade: val(c.DS_NACIONALIDADE),
    idadePosse: num(c.NR_IDADE_DATA_POSSE),
    quilombola: c.ST_QUILOMBOLA === 'S',
    etniaIndigena: c.CD_ETNIA_INDIGENA !== '0' ? val(c.DS_ETNIA_INDIGENA) : null,
    situacaoCandidatura: val(c.DS_SITUACAO_JULGAMENTO),
    tetoGastos: num(c.VR_DESPESA_MAX_CAMPANHA),
  });
}
for (const b of bens) {
  const d = candidatos[b.SQ_CANDIDATO];
  if (!d) continue;
  const valor = num(b.VR_BEM_CANDIDATO) ?? 0;
  d.bens.push([val(b.DS_TIPO_BEM_CANDIDATO), val(b.DS_BEM_CANDIDATO), valor]);
  d.totalBens += valor;
}
for (const d of Object.values(candidatos)) {
  d.bens.sort((a, b) => b[2] - a[2]);
  d.totalBens = Math.round(d.totalBens * 100) / 100;
}

const gerado = `${cand[0].DT_GERACAO} ${cand[0].HH_GERACAO}`;
// Uma linha por candidato ("sq<TAB>json"), com a data de geração na 1ª linha: o servidor guarda o texto
// e indexa só os deslocamentos, sem montar 21 mil objetos na memória.
const linhas = [gerado, ...Object.entries(candidatos).map(([sq, d]) => `${sq}\t${JSON.stringify(d)}`)];
const gz = zlib.gzipSync(linhas.join('\n'), { level: 9 });
await fs.mkdir(path.dirname(SAIDA), { recursive: true });
await fs.writeFile(SAIDA, gz);
console.log(`${Object.keys(candidatos).length} candidatos, ${bens.length} bens (TSE: ${gerado})`);
console.log(`${path.relative(ROOT, SAIDA)}: ${(gz.length / 1e6).toFixed(1)} MB`);
