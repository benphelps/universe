/** Pixel regressions with production ring/cloud shaders and both depth modes. */
import { Color, DepthTexture, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, ShaderMaterial, SphereGeometry, UnsignedIntType, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import { generateSystem } from '../../src/universe/system/generate';
import { createCloudShell } from '../../src/render/terrain/cloudShell';
import { createRingMesh } from '../../src/render/planet/ringMaterial';
import { CloudPass } from '../../src/render/fx/cloudPass';
import { ForegroundRingPass } from '../../src/render/fx/foregroundRingPass';

const output = document.querySelector('pre')!;
document.querySelector('button')!.addEventListener('click', () => {
  const results: unknown[] = [], errors: string[] = [];
  try {
    const planet = generateSystem(0xfdcf84bbf29cdc07n, { xPc: 9325.5920, yPc: 3673.6583, zPc: 49.6306 }).planets[8];
    const physical = structuredClone(planet.physical), radius = 4000, size = 256;
    physical.appearance.clouds.coverage = 1;
    for (const reversed of [false, true]) {
      const renderer = new WebGLRenderer({ reversedDepthBuffer: reversed, alpha: true });
      renderer.setSize(size, size); renderer.setClearColor(0, 0);
      const scene = new Scene(), camera = new PerspectiveCamera(55, 1, 1, radius * 30);
      camera.position.set(0, radius * 2, radius * 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      const body = new Mesh(new SphereGeometry(radius, 64, 32), new MeshBasicMaterial({ color: new Color(.03, .06, .1) }));
      const ring = createRingMesh({ ...planet.rings!, hue: [1, .05, .02], opticalDepth: .1 }, radius);
      ring.rotation.x = -Math.PI / 2;
      const ringMaterial = ring.material as ShaderMaterial;
      ringMaterial.uniforms.uLightDir.value = new Vector3(0, 1, 1).normalize();
      const shell = createCloudShell(physical, radius)!;
      const cloudMaterial = shell.material as ShaderMaterial;
      cloudMaterial.uniforms.uLightDir.value = new Vector3(0, 1, 1).normalize();
      const clouds = new CloudPass(camera), foreground = new ForegroundRingPass(camera);
      clouds.setShell(shell); scene.add(body, ring);
      const beauty = new WebGLRenderTarget(size, size, { depthTexture: new DepthTexture(size, size, UnsignedIntType) });
      const cloudy = beauty.clone();
      const sample = (target: WebGLRenderTarget, point: Vector3) => {
        const ndc = point.clone().project(camera), rgba = new Uint8Array(4);
        renderer.readRenderTargetPixels(target, Math.floor((ndc.x + 1) * size / 2), Math.floor((ndc.y + 1) * size / 2), 1, 1, rgba);
        return Array.from(rgba);
      };
      const front = new Vector3(0, 0, radius * 1.6), back = new Vector3(0, 0, -radius * 1.6);
      let nightFront: number[] = [];
      for (const day of [false, true]) {
        cloudMaterial.uniforms.uLightColor.value = new Color(day ? .7 : 0, day ? .7 : 0, day ? .7 : 0);
        const draw = (split: boolean, showRing = true) => {
          foreground.setRing(split ? ring : null, radius + physical.appearance.clouds.topAltitudeKm);
          ring.visible = showRing;
          renderer.setRenderTarget(beauty); renderer.render(scene, camera);
          clouds.render(renderer, cloudy, beauty);
          if (split) foreground.render(renderer, beauty, cloudy);
          return { front: sample(cloudy, front), back: sample(cloudy, back), sky: sample(cloudy, new Vector3(radius * 2, 0, 0)) };
        };
        const baseline = draw(false, false), before = draw(false), after = draw(true);
        const frontChange = Math.max(...after.front.slice(0, 3).map((v, i) => Math.abs(v - baseline.front[i])));
        const backChange = Math.max(...after.back.slice(0, 3).map((v, i) => Math.abs(v - baseline.back[i])));
        if (frontChange < 8) errors.push(`Foreground ring missing: reversed=${reversed}, day=${day}`);
        if (backChange > 2) errors.push(`Far ring leaks through body: reversed=${reversed}, day=${day}`);
        if (!day && before.front[0] > after.front[0] - 8) errors.push(`Night reproduction not detected: reversed=${reversed}`);
        if (after.sky.some((v, i) => Math.abs(v - before.sky[i]) > 2)) errors.push(`Ring over clear sky blended twice: reversed=${reversed}, day=${day}`);
        if (!day) nightFront = after.front;
        else if (after.front[1] <= nightFront[1] + 5 || after.front[1] >= baseline.front[1] - 2)
          errors.push(`Thin ring failed to transmit its cloud background: reversed=${reversed}`);
        results.push({ reversed, supported: renderer.capabilities.reversedDepthBuffer, day, baseline, before, after });
      }
      foreground.dispose(); clouds.dispose(); beauty.dispose(); cloudy.dispose();
      ring.geometry.dispose(); ringMaterial.dispose(); shell.geometry.dispose(); cloudMaterial.dispose();
      body.geometry.dispose(); body.material.dispose(); renderer.dispose();
    }
    output.textContent = JSON.stringify({ status: errors.length ? 'FAIL' : 'PASS', errors, results }, null, 2);
  } catch (error) { output.textContent = `FAIL: ${error}`; }
});
