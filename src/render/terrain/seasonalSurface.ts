import { Color, DataTexture, FloatType, LinearFilter, RedFormat, RepeatWrapping, Vector2, type ShaderMaterial } from 'three';
import type { SeasonalSurfaceField } from '../../universe/planet/seasonalSurface';
import type { SurfaceParams } from '../../universe/surface/params';

export function seasonalSurfaceUniforms() {
  return { uSeasonalTemperature: {value:null as DataTexture|null}, uSeasonalEnabled:{value:0},
    uSeasonalSize:{value:new Vector2(1,1)},uSeasonalPhase:{value:0},uSeasonalLapse:{value:0},uSeasonalCapK:{value:0},
    uSeasonalIceColor:{value:new Color(1,1,1)} };
}

/** Exactly one texture owned by the focused body, shared by ground/scatter.
 * The immutable completed field uploads once. Only the wrapped phase changes
 * during fast time; this owns no geometry, worker or render target. */
export class SeasonalSurfaceOverlay {
  readonly texture: DataTexture;
  constructor(readonly field: SeasonalSurfaceField) {
    this.texture=new DataTexture(field.temperatureK,field.latitudeCount,field.frameCount,RedFormat,FloatType);
    this.texture.minFilter=this.texture.magFilter=LinearFilter;
    this.texture.wrapT=RepeatWrapping;this.texture.generateMipmaps=false;this.texture.needsUpdate=true;
  }
  dispose(): void { this.texture.dispose(); }
}

export function applySeasonalSurface(material: ShaderMaterial, overlay: SeasonalSurfaceOverlay|null, params?: SurfaceParams): void {
  const u=material.uniforms;
  u.uSeasonalEnabled.value=overlay && params?.surfaceIce && !params.globalIce && !params.magmaCoverage ? 1 : 0;
  u.uSeasonalTemperature.value=overlay?.texture ?? null;
  if(overlay)u.uSeasonalSize.value.set(overlay.field.latitudeCount,overlay.field.frameCount);
  u.uSeasonalLapse.value=params?.lapseKPerKm ?? 0;u.uSeasonalCapK.value=params?.atmosphericCapK ?? 0;
  if(params)u.uSeasonalIceColor.value.setRGB(...params.palette.ice);
}

export const SEASONAL_SURFACE_GLSL = /* glsl */ `
uniform sampler2D uSeasonalTemperature;
uniform float uSeasonalEnabled;
uniform vec2 uSeasonalSize;
uniform float uSeasonalPhase;
uniform float uSeasonalLapse;
uniform float uSeasonalCapK;
uniform vec3 uSeasonalIceColor;

vec3 seasonalSnow(vec3 ground, vec3 up, vec3 normal, float altitudeKm, float mottle) {
  if (uSeasonalEnabled < 0.5) return ground;
  float colatitude=acos(clamp(up.y,-1.0,1.0))/3.141592653589793;
  vec2 uv=vec2((colatitude*(uSeasonalSize.x-1.0)+0.5)/uSeasonalSize.x,uSeasonalPhase+0.5/uSeasonalSize.y);
  float datum=texture2D(uSeasonalTemperature,uv).r;
  // Same prescribed altitude correction as the CPU surface/inspector.
  float temperature=max(min(datum,uSeasonalCapK),datum-uSeasonalLapse*max(0.0,altitudeKm));
  // A restrained cover proxy, not evolving snow mass or latent heat. Keep
  // permanent ice underneath and exclude vertical cliffs from snow cover.
  float snow=(1.0-smoothstep(268.0,274.0,temperature))*smoothstep(0.55,0.82,dot(normal,up));
  return mix(ground,uSeasonalIceColor*mottle,snow);
}
`;
