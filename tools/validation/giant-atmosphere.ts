import { Color, Mesh, PerspectiveCamera, Scene, ShaderMaterial, Vector3, WebGLCubeRenderTarget } from 'three';
import { GIANT_REFERENCES, giantFixture } from '../../src/universe/planet/__fixtures__/giants';
import { PlanetObject } from '../../src/render/planet/planetObject';

import { deriveCirculation } from '../../src/universe/planet/circulation';
import { giantWeatherLifetime } from '../../src/universe/planet/giantWeather';
import { generateSystem } from '../../src/universe/system/generate';
import { RenderPipeline } from '../../src/render/fx/pipeline';

const scene = new Scene(), camera = new PerspectiveCamera(38, 640 / 480, 1, 1e7);
const pipeline = new RenderPipeline(document.querySelector<HTMLElement>('#viewport')!, scene, camera);
const renderer = pipeline.renderer;
const width = 640, height = 480;
pipeline.setSize(width, height, 1);

const errors: string[] = [];
renderer.debug.onShaderError = (gl, program, vertex, fragment) => errors.push(
  [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
const references = [...GIANT_REFERENCES, { name: 'Generated mini-Neptune' }, { name: 'Veliakrar R1M5 c' }];
const generatedEnvelopes = [generateSystem(1n).planets[1].physical, generateSystem(0x5c99c4a91183929cn).planets[1].physical];
const selector = document.querySelector<HTMLSelectElement>('#body')!;
references.forEach((ref, i) => selector.add(new Option(ref.name, String(i))));
let body: PlanetObject, radius = 1;
let physical = giantFixture();
let layers = true;
const light = new Vector3(.6, .15, 1).normalize();
const material = () => (body.group.children[0] as Mesh).material as ShaderMaterial;
// Deliberately freeze bulk rotation while measuring weather continuity.
// This diagnostic access does not add a testing mode to production code.
type WeatherProbe = { spinRadPerDay: number; baked: boolean };
const probe = () => body as unknown as WeatherProbe;
function select(index: number): void {
  if (body) { scene.remove(body.group); body.dispose(); }
  physical = index < GIANT_REFERENCES.length ? giantFixture(GIANT_REFERENCES[index]) : generatedEnvelopes[index - GIANT_REFERENCES.length];
  body = new PlanetObject(physical, null, undefined, 1024);
  body.group.scale.setScalar(6371); scene.add(body.group);
  radius = physical.bulk.radiusEarth * 6371;
  setView('Equator');
}
function setView(view: string): void {
  camera.position.set(0, radius * .3, radius * 3.9);
  if (view === 'Pole') camera.position.set(.01 * radius, 3.9 * radius, .01 * radius);
  if (view === 'Terminator') camera.position.set(-light.z, 0, light.x).normalize().multiplyScalar(3.3 * radius);
  if (view === 'Close') camera.position.set(0, .15 * radius, 1.3 * radius);
  camera.lookAt(0, 0, 0);
}
function draw(t: number, thermal = false, rate = 0): void {
  pipeline.beginFrame();
  scene.updateMatrixWorld(true);
  const lightColor: [number, number, number] = thermal ? [0, 0, 0] : [1, 1, 1];
  body.update(t, light, lightColor, null, renderer,
    { diameterPixels: renderer.domElement.height * camera.projectionMatrix.elements[5] * radius
      / Math.sqrt(Math.max(camera.position.lengthSq() - radius * radius, radius * radius * .01)),
      daysPerSecond: rate, exposure: thermal ? .8 / Math.max(material().uniforms.uThermalStrength.value as number, 1e-30) : 1 });
  material().uniforms.uUpperCloud.value.y = layers ? physical.appearance.banding!.atmosphere!.upperOpticalDepth : 0;
  scene.updateMatrixWorld(true); pipeline.render();
}
function pixels(): Uint8Array {
  const gl = renderer.getContext(), data = new Uint8Array(640 * 480 * 4);
  gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, data);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) errors.push(`GL readback error ${error}`);
  return data;
}
function difference(a: Uint8Array, b: Uint8Array) {
  let mean = 0, changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    let delta = 0;
    for (let c = 0; c < 3; c++) delta += Math.abs(a[i + c] - b[i + c]) / (3 * 255);
    mean += delta;
    if (delta > .02) changed++;
  }
  return { mean: mean / (a.length / 4), fractionOver2Percent: changed / (a.length / 4) };
}

// Probe the complete output path with two known deep-deck albedos. If the
// foreground conceals the deck, changing that albedo stops changing the image.
function deckVisibility(t: number): number {
  const target = new WebGLCubeRenderTarget(4);
  const uniforms = material().uniforms;
  const deckA = uniforms.uDeckA.value, deckB = uniforms.uDeckB.value;
  const upperDepth = uniforms.uUpperCloud.value.y;
  const previous = renderer.getRenderTarget();
  const clearColor = renderer.getClearColor(new Color()), clearAlpha = renderer.getClearAlpha();
  function renderAlbedo(albedo: number, upper: number): Uint8Array {
    renderer.setClearColor(new Color(albedo, albedo, albedo), .25);
    for (let face = 0; face < 6; face++) { renderer.setRenderTarget(target, face); renderer.clear(); }
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColor, clearAlpha);
    uniforms.uDeckA.value = uniforms.uDeckB.value = target.texture;
    uniforms.uUpperCloud.value.y = upper;
    pipeline.render(); return pixels();
  }
  try {
    const cloudy = difference(renderAlbedo(.2, upperDepth), renderAlbedo(.6, upperDepth));
    const clear = difference(renderAlbedo(.2, 0), renderAlbedo(.6, 0));
    return cloudy.mean / Math.max(clear.mean, 1e-9);
  } finally {
    uniforms.uDeckA.value = deckA; uniforms.uDeckB.value = deckB;
    uniforms.uUpperCloud.value.y = upperDepth;
    renderer.setRenderTarget(previous); renderer.setClearColor(clearColor, clearAlpha);
    target.dispose(); draw(t);
  }
}

// A dim pixel is allowed at night; an otherwise lit deck must not acquire
// almost-black cutouts merely because the sun grazes an upper cloud patch.
function grazingShadowCheck(t: number) {
  setView('Terminator'); layers = false; draw(t); const clear = pixels();
  layers = true; draw(t); const cloudy = pixels();
  const ratios: number[] = [];
  for (let i = 0; i < clear.length; i += 4) {
    const luminance = (data: Uint8Array) => .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    const baseline = luminance(clear);
    if (baseline > 25) ratios.push(luminance(cloudy) / baseline);
  }
  ratios.sort((a, b) => a - b);
  return { minimumLightRatio: ratios[0], darkCutoutFraction: ratios.filter(r => r < .5).length / Math.max(ratios.length, 1) };
}

function redraw(): void {
  setView(document.querySelector<HTMLSelectElement>('#view')!.value);
  draw(Number(document.querySelector<HTMLInputElement>('#time')!.value), document.querySelector<HTMLSelectElement>('#view')!.value === 'Thermal');
  const state = physical.appearance.banding!.atmosphere!;
  document.querySelector('#summary')!.textContent = JSON.stringify({ radiusEarth: physical.bulk.radiusEarth,
    heatFluxWm2: physical.interior.heatFluxWm2, effectiveK: physical.climate.effectiveK,
    cloudAltitudeKm: state.upperAltitudeKm, hotspotOffsetDegrees: state.hotspotOffsetRad * 180 / Math.PI,
    upperClouds: layers,
    weatherRenewalDays: giantWeatherLifetime(deriveCirculation(physical).bands),
    thermalView: 'visible Planck radiance with gain normalized to peak; not an infrared image' }, null, 2);
}
selector.onchange = () => { select(Number(selector.value)); redraw(); };
document.querySelector<HTMLButtonElement>('#draw')!.onclick = redraw;
document.querySelector<HTMLButtonElement>('#layers')!.onclick = () => { layers = !layers; redraw(); };
document.querySelector<HTMLSelectElement>('#view')!.onchange = redraw;
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  const button = document.querySelector<HTMLButtonElement>('#run')!;
  button.disabled = true;
  const results: object[] = [];
  document.querySelector('#gallery')!.replaceChildren();
  errors.length = 0;
  try {
    for (let index = 0; index < references.length; index++) {
      // Yield between fixtures so the browser can display progress.
      document.querySelector('#results')!.textContent = `Checking ${references[index].name}…`;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      select(index); probe().spinRadPerDay = 0; layers = true;
      const independent = (t: number) => { probe().baked = false; draw(t); return pixels(); };
      const before = independent(511.999), after = independent(512.001);
      const fold = difference(before, after);
      const control = difference(independent(510.999), independent(511.001));
      const lifetime = giantWeatherLifetime(deriveCirculation(physical).bands);
      const renewal = difference(independent(lifetime * 8 - 1e-5), independent(lifetime * 8 + 1e-5));
      if (renewal.mean > .001 || renewal.fractionOver2Percent > .002) errors.push(`${index}: cloud renewal discontinuity`);
      independent(100); draw(100.01); const played = pixels();
      const history = difference(played, independent(100.01));
      independent(100); draw(99.999); const reversed = pixels();
      const reverse = difference(reversed, independent(99.999));
      const farTime = difference(independent(1e8 - .001), independent(1e8 + .001));
      const visibility = [];
      for (const exposure of [.35, 1, 3]) {
        pipeline.exposure = exposure; independent(100);
        visibility.push({ exposure, retainedDeckSignal: deckVisibility(100) });
      }
      pipeline.exposure = 1;
      if (visibility.some(v => v.retainedDeckSignal < .8)) errors.push(`${index}: upper clouds mask the deeper deck`);
      const grazing = [0, 100, 1e8].map(t => ({ timeDays: t, ...grazingShadowCheck(t) }));
      if (grazing.some(g => g.darkCutoutFraction > .001)) errors.push(`${index}: grazing cloud shadows make black cutouts`);
      setView('Equator');
      const lit = independent(100);
      if (!lit.some((value, i) => i % 4 !== 3 && value > 10)) errors.push(`${index}: blank image`);
      layers = false; draw(100); const layerEffect = difference(lit, pixels()); layers = true;
      if (fold.mean > Math.max(.001, control.mean * 5) || fold.fractionOver2Percent > .002) errors.push(`${index}: weather clock discontinuity`);
      if (history.mean > 1e-6 || reverse.mean > 1e-6) errors.push(`${index}: cache depends on viewing history`);
      if (farTime.mean > .002) errors.push(`${index}: unstable far epoch`);
      if (layerEffect.mean <= 1e-6) errors.push(`${index}: missing upper cloud layer`);
      let thermalEffect = null;
      if (material().uniforms.uHasThermalProfile.value) {
        draw(100, true); const hot = pixels();
        (material().uniforms.uHotspotDirObj.value as Vector3).negate();
        pipeline.render();
        thermalEffect = difference(hot, pixels());
        if (thermalEffect.mean < .001) errors.push(`${index}: hotspot does not affect emission`);
      }
      draw(100);
      const card = document.createElement('div'), img = new Image();
      img.src = renderer.domElement.toDataURL(); img.alt = references[index].name;
      const label = document.createElement('p'); label.textContent = references[index].name;
      card.append(img, label); document.querySelector('#gallery')!.append(card);
      results.push({ name: references[index].name, fold, control, renewal, history, reverse, farTime, layerEffect, thermalEffect, visibility, grazing });
    }
  } catch (error) { errors.push(String(error)); }
  finally {
    select(Number(selector.value)); redraw(); button.disabled = false;
    document.querySelector('#results')!.textContent = JSON.stringify({ passed: errors.length === 0, results, errors }, null, 2);
  }
};
document.querySelector<HTMLButtonElement>('#prepare')!.onclick = () => {
  body.prepare(mesh => pipeline.prepareSceneObject(mesh, scene));
  const wait = () => { redraw(); if ((body as unknown as { preparing: boolean }).preparing) requestAnimationFrame(wait); };
  requestAnimationFrame(wait);
};
select(0); redraw();


// Paired measurement isolates the added cloud layer at a fixed native buffer.
// Includes canonical deck updates at one simulation day per real second.
document.querySelector<HTMLButtonElement>('#measure')!.onclick = async () => {
  const button = document.querySelector<HTMLButtonElement>('#measure')!;
  button.disabled = true;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const results = [];
  const priorLayers = layers;
  const percentile = (values: number[], p: number) => {
    values.sort((a, b) => a - b);
    return values.length ? values[Math.min(values.length - 1, Math.floor(values.length * p))] : null;
  };
  try {
    pipeline.setSize(1280, 960, 1);
    setView('Equator');
    for (const enabled of [false, true]) {
      layers = enabled;
      document.querySelector('#results')!.textContent = `Measuring upper clouds ${enabled ? 'on' : 'off'}…`;
      for (let i = 0; i < 30; i++) { draw(100 + i / 60, false, 1); await frame(); }
      const cpu: number[] = [], gpu: number[] = [];
      for (let i = 0; i < 120; i++) {
        const start = performance.now();
        draw(101 + i / 60, false, 1);
        cpu.push(performance.now() - start);
        if (pipeline.gpuFrameMs !== null) gpu.push(pipeline.gpuFrameMs);
        await frame();
      }
      results.push({ upperClouds: enabled, buffer: '1280x960', warmup: 30, samples: 120,
        cpuMedianMs: percentile(cpu, .5), cpuP95Ms: percentile(cpu, .95),
        gpuMedianMs: percentile(gpu, .5), gpuP95Ms: percentile(gpu, .95), gpuSamples: gpu.length });
    }
    document.querySelector('#results')!.textContent = JSON.stringify({
      fixture: references[Number(selector.value)].name, daysPerSecond: 1,
      gpuTiming: timer ? 'production pipeline timer; latest completed frame per sample' : 'unavailable; CPU submission time is not GPU time', results,
    }, null, 2);
  } finally {
    layers = priorLayers; pipeline.setSize(width, height, 1); redraw(); button.disabled = false;
  }
};
