import { createProgram, createTexture, createTexture3D, createFramebuffer } from './utils';
import { fullscreenQuadVertex } from './vertex.glsl.ts';
import { basicAdjustmentsFragment } from './basic-adjustments.glsl.ts';
import { curvesFragment } from './curves.glsl.ts';
import { levelsFragment } from './levels.glsl.ts';
import { kelvinFragment } from './kelvin.glsl.ts';
import { lutFragment } from './lut.glsl.ts';
import { blendFragment } from './blend.glsl.ts';
import { LutRegistry } from '@/lib/lut-registry';
import { maskStore } from '@/core/mask-store';
import type { Adjustment, BlendMode } from '@/types/adjustment';
import { engineUniformValue } from '@/engine/registry';

interface FBO {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

interface ShaderPass {
  program: WebGLProgram;
  setUniforms: (gl: WebGL2RenderingContext, program: WebGLProgram, adj: Adjustment) => void;
  extraTextures?: (gl: WebGL2RenderingContext, program: WebGLProgram, adj: Adjustment) => WebGLTexture[];
}

const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  'normal': 0,
  'multiply': 1,
  'screen': 2,
  'overlay': 3,
  'darken': 4,
  'lighten': 5,
  'soft-light': 6,
  'hard-light': 7,
};

const QUAD_VERTICES = new Float32Array([
  // position   texCoord
  -1, -1,       0, 0,
   1, -1,       1, 0,
  -1,  1,       0, 1,
   1,  1,       1, 1,
]);

export class WebGLPipeline {
  private gl: WebGL2RenderingContext;
  private fboA: FBO;
  private fboB: FBO;
  private fboC: FBO; // used for blend intermediate
  private vao: WebGLVertexArrayObject;
  private shaders: Map<string, ShaderPass> = new Map();
  private blendProgram: WebGLProgram;
  private sourceTexture: WebGLTexture | null = null;
  private lutTextureCache = new Map<string, WebGLTexture>();
  private maskTexture: WebGLTexture | null = null;
  private width = 0;
  private height = 0;
  private outputCanvas: HTMLCanvasElement;

  constructor() {
    this.outputCanvas = document.createElement('canvas');
    const gl = this.outputCanvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.fboA = this.createFBO(1, 1);
    this.fboB = this.createFBO(1, 1);
    this.fboC = this.createFBO(1, 1);
    this.vao = this.createQuadVAO();
    this.blendProgram = createProgram(gl, fullscreenQuadVertex, blendFragment);
    this.initShaders();
    this.maskTexture = gl.createTexture();
  }

  private createFBO(width: number, height: number): FBO {
    const { gl } = this;
    const texture = createTexture(gl, width, height);
    const framebuffer = createFramebuffer(gl, texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture };
  }

  private resizeFBOs(width: number, height: number): void {
    const { gl } = this;
    this.deleteFBO(this.fboA);
    this.deleteFBO(this.fboB);
    this.deleteFBO(this.fboC);
    this.fboA = this.createFBO(width, height);
    this.fboB = this.createFBO(width, height);
    this.fboC = this.createFBO(width, height);
    this.outputCanvas.width = width;
    this.outputCanvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  private deleteFBO(fbo: FBO): void {
    const { gl } = this;
    gl.deleteFramebuffer(fbo.framebuffer);
    gl.deleteTexture(fbo.texture);
  }

  private createQuadVAO(): WebGLVertexArrayObject {
    const { gl } = this;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

    // a_position
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    // a_texCoord
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);
    return vao;
  }

  private initShaders(): void {
    const { gl } = this;

    // Basic adjustments shader
    const basicProgram = createProgram(gl, fullscreenQuadVertex, basicAdjustmentsFragment);
    this.shaders.set('basic', {
      program: basicProgram,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), engineUniformValue('brightness', (p.brightness as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), engineUniformValue('contrast', (p.contrast as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), engineUniformValue('saturation', (p.saturation as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_hue'), engineUniformValue('hue', (p.hue as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_temperature'), ((p.temperature as number) ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_exposure'), engineUniformValue('exposure', (p.exposure as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_highlights'), engineUniformValue('highlights', (p.highlights as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_shadows'), engineUniformValue('shadows', (p.shadows as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_vibrance'), engineUniformValue('vibrance', (p.vibrance as number) ?? 0));
      },
    });

    // Curves shader
    const curvesProgram = createProgram(gl, fullscreenQuadVertex, curvesFragment);
    this.shaders.set('curves', {
      program: curvesProgram,
      setUniforms: (_gl, _program, _adj) => {
        // Uniforms set in extraTextures
      },
      extraTextures: (gl, program, adj) => {
        const p = adj.params;
        const textures: WebGLTexture[] = [];
        const channels = ['rgb', 'red', 'green', 'blue'] as const;
        channels.forEach((ch, i) => {
          const lut = p[ch] as Float32Array | undefined;
          if (!lut) return;
          const unit = i + 1;
          gl.activeTexture(gl.TEXTURE0 + unit);
          const tex = createTexture(gl, 256, 1);
          const data = new Uint8Array(256 * 4);
          for (let j = 0; j < 256; j++) {
            const v = Math.round(Math.max(0, Math.min(255, lut[j] * 255)));
            data[j * 4] = v;
            data[j * 4 + 1] = v;
            data[j * 4 + 2] = v;
            data[j * 4 + 3] = 255;
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
          gl.uniform1i(gl.getUniformLocation(program, `u_lut_${ch}`), unit);
          textures.push(tex);
        });
        return textures;
      },
    });

    // Levels shader
    const levelsProgram = createProgram(gl, fullscreenQuadVertex, levelsFragment);
    this.shaders.set('levels', {
      program: levelsProgram,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        gl.uniform1f(gl.getUniformLocation(program, 'u_inBlack'), engineUniformValue('inBlack', (p.inBlack as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_inWhite'), engineUniformValue('inWhite', (p.inWhite as number) ?? 255));
        gl.uniform1f(gl.getUniformLocation(program, 'u_gamma'), engineUniformValue('gamma', (p.gamma as number) ?? 1.0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_outBlack'), engineUniformValue('outBlack', (p.outBlack as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_outWhite'), engineUniformValue('outWhite', (p.outWhite as number) ?? 255));
      },
    });

    // Kelvin white balance shader
    const kelvinProgram = createProgram(gl, fullscreenQuadVertex, kelvinFragment);
    this.shaders.set('kelvin', {
      program: kelvinProgram,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        gl.uniform1f(gl.getUniformLocation(program, 'u_kelvin'), engineUniformValue('kelvin', (p.kelvin as number) ?? 6500));
        gl.uniform1f(gl.getUniformLocation(program, 'u_tint'), engineUniformValue('tint', (p.tint as number) ?? 0));
      },
    });

    // LUT filter shader
    const lutProgram = createProgram(gl, fullscreenQuadVertex, lutFragment);
    this.shaders.set('lut', {
      program: lutProgram,
      setUniforms: (gl, program, adj) => {
        gl.uniform1f(gl.getUniformLocation(program, 'u_lutSize'), adj.params.lutSize as number);
      },
      extraTextures: (gl, program, adj) => {
        // Get or create cached 3D LUT texture
        let lutTex = this.lutTextureCache.get(adj.id);
        if (!lutTex) {
          const lutData = LutRegistry.get(adj.id);
          if (!lutData) return [];
          lutTex = createTexture3D(gl, lutData.size, lutData.data);
          this.lutTextureCache.set(adj.id, lutTex);
        }

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, lutTex);
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1);

        return []; // cached — don't delete
      },
    });
  }

  setSource(source: HTMLCanvasElement | HTMLImageElement | OffscreenCanvas | ImageBitmap): void {
    const { gl } = this;

    const w = source.width;
    const h = source.height;

    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.resizeFBOs(w, h);
    }

    if (this.sourceTexture) {
      gl.deleteTexture(this.sourceTexture);
    }
    this.sourceTexture = createTexture(gl, w, h, source);
  }

  render(adjustments: Adjustment[]): HTMLCanvasElement {
    const { gl } = this;
    if (!this.sourceTexture) return this.outputCanvas;

    const enabled = adjustments.filter((a) => a.enabled);
    if (enabled.length === 0) {
      this.drawPass(this.sourceTexture, null, null);
      return this.outputCanvas;
    }

    let currentTex = this.sourceTexture;
    const pingPong = [this.fboA, this.fboB];
    let ppIdx = 0;

    for (let i = 0; i < enabled.length; i++) {
      const adj = enabled[i];
      const shader = this.shaders.get(adj.type);
      if (!shader) continue;

      const isLast = i === enabled.length - 1;
      const needsBlend = adj.blendMode !== 'normal' || adj.opacity < 1;

      if (!needsBlend) {
        // Direct pass — apply adjustment, output becomes new current
        const target = isLast ? null : pingPong[ppIdx].framebuffer;
        const temps = this.drawPass(currentTex, target, shader, adj);
        for (const t of temps) gl.deleteTexture(t);

        if (!isLast) {
          currentTex = pingPong[ppIdx].texture;
          ppIdx = 1 - ppIdx;
        }
      } else {
        // Blend pass: apply adjustment to fboC, then blend currentTex + fboC
        const temps = this.drawPass(currentTex, this.fboC.framebuffer, shader, adj);
        for (const t of temps) gl.deleteTexture(t);

        const blendTarget = isLast ? null : pingPong[ppIdx].framebuffer;
        this.drawBlendPass(currentTex, this.fboC.texture, blendTarget, adj.blendMode, adj.opacity);

        if (!isLast) {
          currentTex = pingPong[ppIdx].texture;
          ppIdx = 1 - ppIdx;
        }
      }
    }

    return this.outputCanvas;
  }

  private drawBlendPass(
    baseTex: WebGLTexture,
    blendTex: WebGLTexture,
    targetFramebuffer: WebGLFramebuffer | null,
    blendMode: BlendMode,
    opacity: number,
  ): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.blendProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, baseTex);
    gl.uniform1i(gl.getUniformLocation(this.blendProgram, 'u_base'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blendTex);
    gl.uniform1i(gl.getUniformLocation(this.blendProgram, 'u_blend'), 1);

    gl.uniform1f(gl.getUniformLocation(this.blendProgram, 'u_opacity'), opacity);
    gl.uniform1i(gl.getUniformLocation(this.blendProgram, 'u_blendMode'), BLEND_MODE_INDEX[blendMode] ?? 0);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private drawPass(
    inputTexture: WebGLTexture,
    targetFramebuffer: WebGLFramebuffer | null,
    shader: ShaderPass | null,
    adj?: Adjustment,
  ): WebGLTexture[] {
    const { gl } = this;
    let tempTextures: WebGLTexture[] = [];

    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
    gl.viewport(0, 0, this.width, this.height);

    if (shader && adj) {
      gl.useProgram(shader.program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform1i(gl.getUniformLocation(shader.program, 'u_texture'), 0);

      shader.setUniforms(gl, shader.program, adj);
      tempTextures = shader.extraTextures?.(gl, shader.program, adj) ?? [];

      // Mask binding — upload R8 mask texture when scope.kind === 'mask'
      const scope = adj.scope ?? { kind: 'global' as const };
      if (scope.kind === 'mask' && this.maskTexture) {
        const mask = maskStore.get(scope.mask_id);
        if (mask) {
          gl.activeTexture(gl.TEXTURE5);
          gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
          gl.texImage2D(
            gl.TEXTURE_2D, 0,
            gl.R8, mask.width, mask.height, 0,
            gl.RED, gl.UNSIGNED_BYTE, mask.data,
          );
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.uniform1i(gl.getUniformLocation(shader.program, 'u_mask'), 5);
          gl.uniform1i(gl.getUniformLocation(shader.program, 'u_useMask'), 1);
        } else {
          gl.uniform1i(gl.getUniformLocation(shader.program, 'u_useMask'), 0);
        }
      } else {
        gl.uniform1i(gl.getUniformLocation(shader.program, 'u_useMask'), 0);
      }
    } else {
      // Passthrough — use basic shader with neutral params
      const basic = this.shaders.get('basic')!;
      gl.useProgram(basic.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform1i(gl.getUniformLocation(basic.program, 'u_texture'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_brightness'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_contrast'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_saturation'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_hue'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_temperature'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_exposure'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_highlights'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_shadows'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_vibrance'), 0);
      gl.uniform1i(gl.getUniformLocation(basic.program, 'u_useMask'), 0);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    return tempTextures;
  }

  clearLutCache(adjustmentId?: string): void {
    const { gl } = this;
    if (adjustmentId) {
      const tex = this.lutTextureCache.get(adjustmentId);
      if (tex) {
        gl.deleteTexture(tex);
        this.lutTextureCache.delete(adjustmentId);
      }
    } else {
      for (const tex of this.lutTextureCache.values()) gl.deleteTexture(tex);
      this.lutTextureCache.clear();
    }
  }

  getOutputCanvas(): HTMLCanvasElement {
    return this.outputCanvas;
  }

  dispose(): void {
    const { gl } = this;
    this.deleteFBO(this.fboA);
    this.deleteFBO(this.fboB);
    this.deleteFBO(this.fboC);
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    if (this.maskTexture) gl.deleteTexture(this.maskTexture);
    for (const shader of this.shaders.values()) {
      gl.deleteProgram(shader.program);
    }
    this.shaders.clear();
    gl.deleteProgram(this.blendProgram);
    this.clearLutCache();
  }
}
