import { Color, DepthTexture, FloatType, Mesh, MeshBasicMaterial, NoBlending, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { AU, G, SOLAR_MASS } from '../../src/core/physics/constants';
import { mu } from '../../src/core/physics/units';
import { generateStar } from '../../src/universe/star/generate';
import { computeZones } from '../../src/universe/system/zones';
import { characterizePlanet } from '../../src/universe/planet/characterize';
import { createCloudShell } from '../../src/render/terrain/cloudShell';
import { CloudPass } from '../../src/render/fx/cloudPass';

const star = generateStar(1n, { massInitial: 1, ageGyr: 4.6, feH: 0, withCompanions: false });
const elements = { semiMajorAxis: AU, eccentricity: 0, inclination: 0, longitudeOfAscendingNode: 0,
  argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0 };
const physical = characterizePlanet(19n, 'rocky', 1, elements, {
  star, centralLuminosity: star.luminosity, mu: mu(G * SOLAR_MASS), zones: computeZones(star.luminosity, star.tEff, star.ageGyr, 1),
});
physical.atmosphere.class = 'nitrogen-oxygen';
Object.assign(physical.appearance.clouds, { coverage: 1, topAltitudeKm: 4, thicknessKm: 2, opticalDepth: 5, color: [1, 1, 1] });
const cases = [
  { name: 'mountain above deck', eye: 10, ground: 6, up: false, cloudy: false },
  { name: 'mountain inside deck', eye: 10, ground: 3, up: false, cloudy: true },
  { name: 'terrain below deck', eye: 10, ground: 0, up: false, cloudy: true },
  { name: 'within cloud looking down', eye: 3, ground: 0, up: false, cloudy: true },
  { name: 'within cloud near rock', eye: 3, ground: 2.999, up: false, cloudy: true },
  { name: 'below cloud foreground ridge', eye: 1, ground: 1.5, up: true, cloudy: false },
  { name: 'below cloud embedded ridge', eye: 1, ground: 3, up: true, cloudy: true },
  { name: 'below cloud clear sky', eye: 1, ground: null, up: true, cloudy: true },
  { name: 'below cloud looking down', eye: 1, ground: 0, up: false, cloudy: false },
  { name: 'above cloud looking away', eye: 10, ground: null, up: true, cloudy: false },
  { name: 'inside cloud looking up', eye: 3, ground: null, up: true, cloudy: true },
  { name: 'orbit full deck', eye: 5000, ground: 0, up: false, cloudy: true },
];
document.querySelector('button')!.onclick = () => {
  const results: object[] = [], errors: string[] = [];
  for (const reversedDepthBuffer of [false, true]) {
    const renderer = new WebGLRenderer({ reversedDepthBuffer });
    renderer.setSize(129, 129); renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      errors.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
    };
    const r = 6371, camera = new PerspectiveCamera(40, 1, 0.0001, 50000);
    const scene = new Scene(); scene.background = new Color(0.01, 0.025, 0.1);
    const ground = new Mesh(new PlaneGeometry(100000, 100000), new MeshBasicMaterial({ color: new Color(0.01, 0.025, 0.1), side: 2 }));
    scene.add(ground);
    const shell = createCloudShell(physical, r)!, material = shell.material as ShaderMaterial;
    // Vacuum transport isolates cloud/solid depth; this is not a climate fixture.
    for (const key of ['uRayleighDepth', 'uAerosolScatterDepth', 'uAerosolExtinction', 'uOpticalDepth', 'uSurfaceRayleighDepth', 'uSurfaceAerosolDepth']) material.uniforms[key].value.setRGB(0, 0, 0);
    const pass = new CloudPass(camera); pass.setShell(shell);
    const source = new WebGLRenderTarget(129, 129, { type: FloatType, depthTexture: new DepthTexture(129, 129) });
    const dest = source.clone(), depthResult = new WebGLRenderTarget(129, 129, { type: FloatType, depthBuffer: false });
    const compare = new ShaderMaterial({ uniforms: { a: { value: source.depthTexture }, b: { value: dest.depthTexture } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0,1);}',
      fragmentShader: 'varying vec2 vUv; uniform sampler2D a; uniform sampler2D b; void main(){float x=texture2D(a,vUv).r; float y=texture2D(b,vUv).r; gl_FragColor=vec4(x,y,abs(x-y),1);}',
      depthTest: false, depthWrite: false, blending: NoBlending,
    });
    const quad = new FullScreenQuad(compare);
    const radial = new Vector3(0.4, 0.3, Math.sqrt(0.75));
    ground.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), radial);
    for (const c of cases) {
      camera.near = c.name === 'within cloud near rock' ? 0.0001 : Math.max(0.0001, c.eye * 0.001);
      camera.updateProjectionMatrix();
      camera.position.copy(radial).multiplyScalar(r + c.eye); camera.up.set(0, 1, 0);
      camera.lookAt(radial.clone().multiplyScalar(r + c.eye + (c.up ? 1 : -1))); camera.updateMatrixWorld();
      ground.visible = c.ground !== null; ground.position.copy(radial).multiplyScalar(r + (c.ground ?? 0));
      ground.scale.setScalar(Math.max(0.01, Math.abs(c.eye - (c.ground ?? 0)) * 2) / 100000);
      renderer.setRenderTarget(source); renderer.render(scene, camera);
      const before = new Float32Array(4), after = new Float32Array(4), depth = new Float32Array(4);
      renderer.readRenderTargetPixels(source, 64, 64, 1, 1, before);
      pass.render(renderer, dest, source);
      renderer.readRenderTargetPixels(dest, 64, 64, 1, 1, after);
      renderer.setRenderTarget(depthResult); quad.render(renderer);
      renderer.readRenderTargetPixels(depthResult, 64, 64, 1, 1, depth);
      const difference = Math.max(...[0, 1, 2].map(i => Math.abs(after[i] - before[i])));
      const correct = c.cloudy ? difference > 1e-5 && (c.name !== 'within cloud near rock' || difference < 0.01) : difference < 1e-6;
      if (c.ground !== null && depth[0] === (renderer.capabilities.reversedDepthBuffer ? 0 : 1)) errors.push(`${c.name}: missing solid depth`);
      const image = new Float32Array(129 * 129 * 4), depthImage = new Float32Array(image.length);
      renderer.readRenderTargetPixels(dest, 0, 0, 129, 129, image);
      renderer.readRenderTargetPixels(depthResult, 0, 0, 129, 129, depthImage);
      const finite = image.every(Number.isFinite) && depthImage.every(Number.isFinite);
      let maxDepthError = 0;
      for (let i = 2; i < depthImage.length; i += 4) maxDepthError = Math.max(maxDepthError, depthImage[i]);
      results.push({ reversed: renderer.capabilities.reversedDepthBuffer, ...c, before: [...before], after: [...after], depth: [...depth], difference, correct, finite, maxDepthError });
      if (!correct || !finite || maxDepthError > 1e-7) errors.push(`${reversedDepthBuffer}: ${c.name} failed`);
    }
    source.dispose(); dest.dispose(); depthResult.dispose(); quad.dispose(); compare.dispose();
    pass.dispose(); shell.geometry.dispose(); material.dispose(); ground.geometry.dispose(); ground.material.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
  document.querySelector('pre')!.textContent = JSON.stringify({ errors, results }, null, 2);
};
