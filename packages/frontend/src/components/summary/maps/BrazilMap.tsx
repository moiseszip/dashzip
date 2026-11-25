import brazil from '@svg-maps/brazil';
import type { GeoMapProps } from '@/components/summary/GeoCard';

/**
 * Mapa do Brasil por UF (@svg-maps/brazil, CC BY 4.0, VictorCazanave/svg-maps).
 * Carregado sob demanda. O id de cada estado é a UF em minúsculas.
 */
interface SvgMap { viewBox: string; locations: { id: string; name: string; path: string }[] }
const map = brazil as unknown as SvgMap;

export default function BrazilMap({ width, height, valueOf, onHover, active }: GeoMapProps) {
  return (
    <svg width={width} height={height} viewBox={map.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa do Brasil das vendas por estado">
      {map.locations.map((loc) => {
        const uf = loc.id.toUpperCase();
        const value = valueOf(uf);
        return (
          <path
            key={loc.id} d={loc.path}
            className={value === null ? 'fill-foreground/10 stroke-background' : 'stroke-background'}
            style={value === null ? undefined : { fill: 'var(--viz-1)', fillOpacity: 0.25 + value * 0.75 }}
            strokeWidth={active === uf ? 2.5 : 1}
            onMouseEnter={() => onHover(uf)} onMouseLeave={() => onHover(null)} onClick={() => onHover(uf)}
          />
        );
      })}
    </svg>
  );
}
