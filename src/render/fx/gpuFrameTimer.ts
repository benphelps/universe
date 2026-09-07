/** EXT_disjoint_timer_query_webgl2 tokens missing from DOM typings. */
interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/** Nonblocking whole-frame timing. A stalled GPU must not grow a query
 *  queue without bound; disjoint results are invalid, not cheap frames.
 *  https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/ */
export class GpuFrameTimer {
  elapsedMs: number | null = null;
  private readonly extension: TimerExtension | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
  }

  begin(): void {
    const ext = this.extension;
    if (!ext || this.active) return;
    const gl = this.gl;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.clearPending();
      this.elapsedMs = null;
      return;
    }
    // Consume in submission order so an old result cannot overwrite a
    // newer one when several queries become available together.
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift()!;
      this.elapsedMs = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
      gl.deleteQuery(query);
    }
    if (this.pending.length >= 8) return;
    const query = gl.createQuery();
    if (!query) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  private clearPending(): void {
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending = [];
  }

  dispose(): void {
    this.end();
    this.clearPending();
  }
}
