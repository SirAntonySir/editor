import { createProgram, createTexture, createFramebuffer } from './utils';
import { fullscreenQuadVertex } from './vertex.glsl.ts';
import { basicAdjustmentsFragment } from './basic-adjustments.glsl.ts';
import { curvesFragment } from './curves.glsl.ts';
import { levelsFragment } from './levels.glsl.ts';
import type { Adjustment } from '@/store/layer-slice';

interface FBO {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

interface ShaderPass {
  program: WebGLProgram;
  setUniforms: (gl: WebGL2RenderingContext, program: WebGLProgram, adj: Adjustment) => void;
  extraTextures?: (gl: WebGL2RenderingContext, program: WebGLProgram, adj: Adjustment) => WebGLTexture[];
}

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
  private vao: WebGLVertexArrayObject;
  private shaders: Map<string, ShaderPass> = new Map();
  private sourceTexture: WebGLTexture | null = null;
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

    // Placeholder FBOs — will be resized when source is set
    this.fboA = this.createFBO(1, 1);
    this.fboB = this.createFBO(1, 1);
    this.vao = this.createQuadVAO();
    this.initShaders();
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
    this.fboA = this.createFBO(width, height);
    this.fboB = this.createFBO(width, height);
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
        gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), (p.brightness as number ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), (p.contrast as number ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), (p.saturation as number ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_hue'), (p.hue as number ?? 0) * Math.PI / 180);
        gl.uniform1f(gl.getUniformLocation(program, 'u_temperature'), (p.temperature as number ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_tint'), (p.tint as number ?? 0) / 100);
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
        gl.uniform1f(gl.getUniformLocation(program, 'u_inBlack'), (p.inBlack as number ?? 0) / 255);
        gl.uniform1f(gl.getUniformLocation(program, 'u_inWhite'), (p.inWhite as number ?? 255) / 255);
        gl.uniform1f(gl.getUniformLocation(program, 'u_gamma'), p.gamma as number ?? 1.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_outBlack'), (p.outBlack as number ?? 0) / 255);
        gl.uniform1f(gl.getUniformLocation(program, 'u_outWhite'), (p.outWhite as number ?? 255) / 255);
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
      // No adjustments — just copy source to output
      this.drawPass(this.sourceTexture, null, null);
      return this.outputCanvas;
    }

    let readTexture = this.sourceTexture;
    let writeFBO = this.fboA;
    let readFBO = this.fboB;

    for (let i = 0; i < enabled.length; i++) {
      const adj = enabled[i];
      const shader = this.shaders.get(adj.type);
      if (!shader) continue;

      const isLast = i === enabled.length - 1;
      const target = isLast ? null : writeFBO.framebuffer;

      const tempTextures = this.drawPass(readTexture, target, shader, adj);

      for (const tex of tempTextures) {
        gl.deleteTexture(tex);
      }

      if (!isLast) {
        readTexture = writeFBO.texture;
        const tmp = writeFBO;
        writeFBO = readFBO;
        readFBO = tmp;
      }
    }

    return this.outputCanvas;
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

      // Bind source texture to unit 0
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform1i(gl.getUniformLocation(shader.program, 'u_texture'), 0);

      shader.setUniforms(gl, shader.program, adj);
      tempTextures = shader.extraTextures?.(gl, shader.program, adj) ?? [];
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
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_tint'), 0);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    return tempTextures;
  }

  getOutputCanvas(): HTMLCanvasElement {
    return this.outputCanvas;
  }

  dispose(): void {
    const { gl } = this;
    this.deleteFBO(this.fboA);
    this.deleteFBO(this.fboB);
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    for (const shader of this.shaders.values()) {
      gl.deleteProgram(shader.program);
    }
    this.shaders.clear();
  }
}
