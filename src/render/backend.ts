// Picking the renderer: WebGPU where the browser and GPU have it, WebGL 2 otherwise (or when asked for).
import type { Renderer } from './renderer';
import { GLRenderer } from './glrenderer';
import { GPURenderer } from './gpurenderer';

/** Options > More... > Graphics: 'auto' is WebGPU when there is one. */
export type GfxChoice = 'auto' | 'webgpu' | 'webgl2';

export async function createRenderer(canvas: HTMLCanvasElement, choice: GfxChoice = 'auto'): Promise<Renderer> {
  const q = new URLSearchParams(location.search).get('gfx');
  if (q === 'webgpu' || q === 'webgl2') choice = q;
  if (choice !== 'webgl2' && typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      return await GPURenderer.create(canvas);
    } catch (e) {
      console.warn('WebGPU unavailable, drawing with WebGL 2:', e);
      // a canvas that has been given a WebGPU context can't have a WebGL one: start again with a fresh one
      if (canvas.getAttribute('data-gfx') === 'webgpu') {
        const fresh = canvas.cloneNode() as HTMLCanvasElement;
        canvas.replaceWith(fresh);
        canvas = fresh;
      }
    }
  }
  return new GLRenderer(canvas);
}
