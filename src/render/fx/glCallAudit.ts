import { beginLoadingWork, endLoadingWork } from '../../app/loadingWorkAudit';

/** Opt-in driver-call attribution. Keep ordinary rendering entirely unwrapped. */
export function auditGlCalls(gl: WebGL2RenderingContext): () => void {
  const query = new URLSearchParams(location.search);
  if (!query.has('benchmark') || !query.has('benchmarkGL')) return () => {};
  const methods = [
    'texStorage3D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'texImage2D',
    'texSubImage2D', 'bufferData', 'bufferSubData', 'drawElements', 'drawArrays',
    'drawElementsInstanced', 'drawArraysInstanced', 'getProgramParameter',
    'getShaderParameter', 'getUniformLocation', 'getActiveUniform', 'linkProgram',
    'compileShader', 'useProgram', 'getError', 'getParameter',
    'getActiveAttrib', 'getAttribLocation', 'checkFramebufferStatus',
  ];
  const context = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
  const restore: (() => void)[] = [];
  const shaders = new WeakMap<object, string>();
  const programs = new WeakMap<object, string[]>();
  const shaderSource = gl.shaderSource.bind(gl), attachShader = gl.attachShader.bind(gl);
  gl.shaderSource = (shader, source) => {
    const tags = ['uSurfaceCube', 'uDeckA', 'uStorms', 'uMorph', 'uSeasonal', 'uCloudBaseRadius', 'uSceneDepth', 'uAtmosphere', 'uVolume', 'uColumn']
      .filter(tag => source.includes(tag));
    shaders.set(shader, tags.join('+') || /#define SHADER_NAME (\S+)/.exec(source)?.[1] || 'unknown');
    shaderSource(shader, source);
  };
  gl.attachShader = (program, shader) => {
    programs.set(program, [...(programs.get(program) ?? []), shaders.get(shader) ?? 'unknown']);
    attachShader(program, shader);
  };
  restore.push(() => { gl.shaderSource = shaderSource; gl.attachShader = attachShader; });
  for (const name of methods) {
    const original = context[name];
    context[name] = (...args: unknown[]) => {
      const start = beginLoadingWork();
      try { return original.apply(gl, args); }
      finally {
        if (performance.now() - start >= 1) {
          const detail = args.map(arg => typeof arg === 'number' ? arg
            : ArrayBuffer.isView(arg) ? `${arg.byteLength}B`
            : arg && typeof arg === 'object' ? programs.get(arg)?.join('/') ?? '_' : '_').join(',');
          endLoadingWork(`gl.${name}(${detail})`, start);
        }
      }
    };
    restore.push(() => { context[name] = original; });
  }
  return () => { for (const undo of restore) undo(); };
}
