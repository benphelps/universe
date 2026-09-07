/** Component ages independent of spatial density, so integrating a
 * population never recursively asks for the galaxy it is normalizing. */
export type StellarComponent = 'thin-disk' | 'thick-disk' | 'halo' | 'bulge';

export type PopulationComponent = StellarComponent | 'nuclear-young';

export function componentAgeForUnit(component: PopulationComponent, unit: number): number {
  const v = Math.max(0, Math.min(1, unit));
  switch (component) {
    case 'thin-disk': return thinAgeForUnit(v);
    case 'thick-disk': return 8 + 4 * v;
    case 'halo': return 10 + 3.2 * v;
    case 'bulge': return 8 + 5.2 * v;
    case 'nuclear-young': return 0.005 + 0.1 * v;
  }
}

export function thinAgeForUnit(v: number): number {
  return 0.03 + 9.97 * v ** 1.2;
}

export function componentUnitForAge(component: PopulationComponent, ageGyr: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  switch (component) {
    case 'thin-disk': return clamp((ageGyr - 0.03) / 9.97) ** (1 / 1.2);
    case 'thick-disk': return clamp((ageGyr - 8) / 4);
    case 'halo': return clamp((ageGyr - 10) / 3.2);
    case 'bulge': return clamp((ageGyr - 8) / 5.2);
    case 'nuclear-young': return clamp((ageGyr - 0.005) / 0.1);
  }
}
