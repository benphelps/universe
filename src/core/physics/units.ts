declare const unitTag: unique symbol;

/**
 * Branded SI quantity: usable anywhere a number is (arithmetic degrades
 * the brand, as TypeScript arithmetic always does), but a plain number —
 * or the wrong unit — cannot flow into a parameter demanding the brand.
 * Producers brand once with the constructors below; consumers are then
 * checked at the API boundary.
 */
export type Quantity<Unit extends string> = number & { readonly [unitTag]: Unit };

export type Meters = Quantity<'m'>;
export type Seconds = Quantity<'s'>;
export type Kilograms = Quantity<'kg'>;
export type Kelvin = Quantity<'K'>;
export type Watts = Quantity<'W'>;
/** Standard gravitational parameter G(M+m), m³ s⁻². */
export type Mu = Quantity<'m3s-2'>;

export const meters = (value: number): Meters => value as Meters;
export const seconds = (value: number): Seconds => value as Seconds;
export const kilograms = (value: number): Kilograms => value as Kilograms;
export const kelvin = (value: number): Kelvin => value as Kelvin;
export const watts = (value: number): Watts => value as Watts;
export const mu = (value: number): Mu => value as Mu;
