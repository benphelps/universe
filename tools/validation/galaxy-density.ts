import { FloatType, GLSL3, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { buildGalaxyRadianceGlsl } from '../../src/render/glsl/galaxyRadiance';
import { galaxyLutTextures } from '../../src/render/galaxy/galaxyLuts';
import { armProfile } from '../../src/universe/galaxy/density';
import { setGalaxySeed } from '../../src/universe/galaxy/galaxySeed';
const seed = new URLSearchParams(location.search).get('galaxy') ?? '53494d5f554e4956';
setGalaxySeed(BigInt('0x' + seed));
const luts = galaxyLutTextures();
document.querySelector<HTMLButtonElement>('#run')!.onclick = () => {
  const renderer = new WebGLRenderer(), target = new WebGLRenderTarget(1, 1, {type: FloatType});
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1), scene = new Scene();
  const material = new ShaderMaterial({ glslVersion: GLSL3,
    uniforms: {uPoint: {value: new Vector2()}, uArmLut: {value: luts.armLut}, uClumpNoise: {value: luts.clumpTile}},
    vertexShader: 'void main(){gl_Position=vec4(position,1.0);}',
    fragmentShader: `precision highp float; uniform vec2 uPoint; out vec4 result; ${buildGalaxyRadianceGlsl()}
      void main(){result=vec4(armProfile(uPoint.x,uPoint.y),0.0,1.0);}` });
  const geometry = new PlaneGeometry(2, 2); scene.add(new Mesh(geometry, material));
  const pixel = new Float32Array(4); let maxError = 0, sum = 0, negativeSamples = 0;
  let minDensity = 1, meanBoost = 0;
  for (let i=0;i<512;i++) {
    const r = [500, 1500, 3001, 5493, 8099, 13234, 18789, 24000][i%8];
    const theta = i * 0.61803398875 * 2 * Math.PI - Math.PI;
    material.uniforms.uPoint.value.set(r/1000,theta);
    renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1,1,pixel);
    const p = armProfile(r,theta);
    const error = Math.max(Math.abs(p.boost-pixel[0]), Math.abs(p.lane-pixel[1]));
    maxError = Math.max(maxError,error);sum+=error;
    if (pixel[0] < 0) negativeSamples++;
    minDensity=Math.min(minDensity,1+pixel[0],1+1.4*pixel[1]); meanBoost+=pixel[0];
  }
  const passed = negativeSamples>0 && minDensity>0 && maxError<0.12 && sum/512<0.01;
  document.querySelector('#result')!.textContent=JSON.stringify({seed,passed,maxError,meanError:sum/512,negativeSamples,minDensity,meanBoost:meanBoost/512,textureVersion:luts.armLut.version},null,2);
  geometry.dispose();material.dispose();target.dispose();renderer.dispose();
};
