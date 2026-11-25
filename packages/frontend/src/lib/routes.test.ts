import { describe, expect, it } from 'vitest';
import { MAIN_DATA_PATHS, pageForPath, pageImports } from '@/lib/routes';

describe('routes', () => {
  it('liga cada caminho do menu a uma página com import', () => {
    for (const path of ['/finance', '/campaigns/meta', '/sales', '/tests', '/costs', '/live', '/preview', '/integrations', '/rules', '/settings', '/hotjar']) {
      const page = pageForPath(path);
      expect(page, path).not.toBeNull();
      expect(typeof pageImports[page!]).toBe('function');
    }
  });

  it('não pré-carrega caminho desconhecido', () => {
    expect(pageForPath('/nada')).toBeNull();
  });

  it('busca de antemão os dados das telas da barra inferior', () => {
    expect(MAIN_DATA_PATHS).toEqual(['/finance', '/campaigns/meta']);
  });
});
