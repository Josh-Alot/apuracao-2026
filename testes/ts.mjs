// Deixa os testes (node --test) importarem os módulos .ts do front como o Vite: sem a extensão no import.
// O Node já remove os tipos sozinho; só falta tentar `.ts` quando o caminho relativo não tem extensão.
// Só serve para módulos .ts puros (sem JSX e sem `enum`): o que tem lógica testável fica fora dos .tsx.

import { registerHooks } from 'node:module';

registerHooks({
  resolve(especificador, contexto, proximo) {
    try {
      return proximo(especificador, contexto);
    } catch (err) {
      if (!/^\.\.?\//.test(especificador) || /\.[cm]?[jt]sx?$/.test(especificador)) throw err;
      return proximo(`${especificador}.ts`, contexto);
    }
  },
});
