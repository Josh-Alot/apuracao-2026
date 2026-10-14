import { fmt } from '../../lib/util';
import { Link } from '../../rota/Link';

/**
 * Links para as regiões do mapa (fechado por padrão). O SVG do mapa não usa <a href> (arrastar um link inicia o
 * "arrastar e soltar" do navegador e o toque longo abre a prévia do link, o que atrapalharia o zoom/arraste);
 * sem esta lista, as páginas de UF e de município não teriam link rastreável.
 */
export function IndiceRegioes({ rotulo, itens, aberto, onAlternar, href, onSelect }: {
  rotulo: string; itens: { chave: string; nome: string }[]; aberto: boolean; onAlternar: (aberto: boolean) => void;
  href: (k: string) => string; onSelect: (k: string) => void;
}) {
  return (
    <details className="indice-regioes" id="indice-regioes" open={aberto} onToggle={(e) => onAlternar(e.currentTarget.open)}>
      <summary>{rotulo} ({fmt(itens.length)})</summary>
      <ul>
        {itens.map((i) => (
          <li key={i.chave}><Link href={href(i.chave)} onNavegar={() => onSelect(i.chave)}>{i.nome}</Link></li>
        ))}
      </ul>
    </details>
  );
}
