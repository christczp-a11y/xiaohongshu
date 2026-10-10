// Densities in kg/m³. These are the usual textbook values; per design.md §4
// they must be checked against a reliable density table before launch.
// Wood and brine vary in real life, so the UI calls them approximate.

export interface Liquid {
  id: 'alcohol' | 'water' | 'brine';
  name: string;
  density: number;
}

export interface Solid {
  id: 'wood' | 'wax' | 'aluminium' | 'iron' | 'copper';
  name: string;
  density: number;
}

export const LIQUIDS: Liquid[] = [
  { id: 'alcohol', name: '酒精', density: 800 },
  { id: 'water', name: '水', density: 1000 },
  { id: 'brine', name: '盐水', density: 1100 },
];

export const SOLIDS: Solid[] = [
  { id: 'wood', name: '木块', density: 500 },
  { id: 'wax', name: '蜡块', density: 900 },
  { id: 'aluminium', name: '铝块', density: 2700 },
  { id: 'iron', name: '铁块', density: 7900 },
  { id: 'copper', name: '铜块', density: 8900 },
];

export const liquid = (id: Liquid['id']) => LIQUIDS.find((l) => l.id === id)!;
export const solid = (id: Solid['id']) => SOLIDS.find((s) => s.id === id)!;

/** "2.7" style label in units of 10³ kg/m³. */
export const densityLabel = (d: number) => (d / 1000).toFixed(1);
