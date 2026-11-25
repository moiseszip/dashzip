import { useMemo } from 'react';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import type { GeoMapProps } from '@/components/summary/GeoCard';

/**
 * Mapa-múndi (Natural Earth 1:110m via world-atlas, domínio público). Carregado
 * sob demanda: só baixa quando um card de país aparece. O id de cada país é o
 * código numérico ISO 3166, o mesmo `numeric` que o backend manda.
 */
const topology = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const countries = feature(topology, topology.objects.countries) as FeatureCollection<Geometry, { name: string }>;

export default function WorldMap({ width, height, valueOf, onHover, active }: GeoMapProps) {
  const paths = useMemo(() => {
    const projection = geoEqualEarth().fitExtent([[2, 2], [Math.max(width - 2, 10), Math.max(height - 2, 10)]], { type: 'Sphere' });
    const path = geoPath(projection);
    return countries.features
      .filter((f) => f.properties.name !== 'Antarctica')
      .map((f) => ({ id: String(f.id ?? ''), name: f.properties.name, d: path(f) ?? '' }));
  }, [width, height]);

  return (
    <svg width={width} height={height} role="img" aria-label="Mapa-múndi das vendas por país">
      {paths.map((p) => {
        const value = p.id ? valueOf(p.id) : null;
        return (
          <path
            key={p.id || p.name} d={p.d}
            className={value === null ? 'fill-foreground/10 stroke-background' : 'stroke-background'}
            style={value === null ? undefined : { fill: 'var(--viz-1)', fillOpacity: 0.25 + value * 0.75 }}
            strokeWidth={active === p.id ? 1.5 : 0.5}
            onMouseEnter={() => onHover(p.id || null)} onMouseLeave={() => onHover(null)}
            onClick={() => onHover(p.id || null)}
          />
        );
      })}
    </svg>
  );
}
