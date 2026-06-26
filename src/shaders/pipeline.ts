import { createProgram, createTexture, createTexture3D, createFramebuffer } from './utils';
import { fullscreenQuadVertex } from './vertex.glsl.ts';
import { basicAdjustmentsFragment } from './basic-adjustments.glsl.ts';
import { curvesFragment } from './curves.glsl.ts';
import { levelsFragment } from './levels.glsl.ts';
import { kelvinFragment } from './kelvin.glsl.ts';
import { hslFragment } from './hsl.glsl.ts';
import { sharpenFragment } from './sharpen.glsl.ts';
import { blurFragment } from './blur.glsl.ts';
import { clarityFragment } from './clarity.glsl.ts';
import { grainFragment } from './grain.glsl.ts';
import { vignetteFragment } from './vignette.glsl.ts';
import { splitToneFragment } from './split-tone.glsl.ts';
import { lutFragment } from './lut.glsl.ts';
import { blendFragment } from './blend.glsl.ts';
import { LutRegistry } from '@/lib/lut-registry';
import { maskStore } from '@/core/mask-store';
import type { Adjustment, BlendMode } from '@/types/adjustment';
import type { HiBitImage } from '@/lib/png16';
import { engineUniformValue } from '@/engine/registry';

interface FBO {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

interface RenderIntoCtx {
  gl: WebGL2RenderingContext;
  inputTexture: WebGLTexture;
  targetFramebuffer: WebGLFramebuffer | null;
  scratchA: FBO;
  scratchB: FBO;
  width: number;
  height: number;
  texel: [number, number];
  drawQuad: () => void;
}

interface ShaderPass {
  program: WebGLProgram;
  setUniforms: (gl: WebGL2RenderingContext, program: WebGLProgram, adj: Adjustment) => void;
  extraTextures?: (gl: WebGL2RenderingContext, program: WebGLProgram, adj: Adjustment) => WebGLTexture[];
  /** When true, drawPass sets u_texel = (1/width, 1/height) before drawing. */
  needsTexel?: boolean;
  /** Optional multi-pass override. When present the render loop calls this
   *  instead of a single drawPass; it must end by drawing into targetFramebuffer. */
  renderInto?: (ctx: RenderIntoCtx, adj: Adjustment) => void;
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
  private fboD: FBO;
  private vao: WebGLVertexArrayObject;
  private shaders: Map<string, ShaderPass> = new Map();
  private blendProgram: WebGLProgram;
  private sourceTexture: WebGLTexture | null = null;
  /** Float pipeline state. `floatSupported` is set once at init from
   *  EXT_color_buffer_float; `floatMode` flips per source (true after
   *  setHiBitSource, false after setSource); `fboFloat` tracks the FBO
   *  textures' current internal format so format switches re-allocate. */
  private floatSupported = false;
  private floatMode = false;
  private fboFloat = false;
  /** Identity for the source bound to `sourceTexture`. Lets `setSource`
   *  skip the GPU upload when the caller passes the same canvas/bitmap
   *  again (common: only an adjustment param moved). */
  private sourceIdentity: object | null = null;
  private lutTextureCache = new Map<string, WebGLTexture>();
  /** Per-curve-adjustment LUT textures. Persistent — reused across
   *  frames; each frame's `texImage2D` re-uploads pixels onto the same
   *  GL handle instead of allocating a new texture. */
  private curvesLutTextures = new Map<string, WebGLTexture>();
  /** Shared identity LUT — bound for curves channels that don't have a
   *  per-channel LUT set. Created once at init. */
  private identityLutTexture: WebGLTexture | null = null;
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

    // Float render targets (RGBA16F) for the high-bit-depth path. Enabling
    // this extension is what makes RGBA16F FBOs color-renderable; 16F linear
    // filtering is core in WebGL2. Absent ⇒ the hi-bit path stays off and RAW
    // renders 8-bit (no regression).
    this.floatSupported = gl.getExtension('EXT_color_buffer_float') !== null;

    this.fboA = this.createFBO(1, 1);
    this.fboB = this.createFBO(1, 1);
    this.fboC = this.createFBO(1, 1);
    this.fboD = this.createFBO(1, 1);
    this.vao = this.createQuadVAO();
    this.blendProgram = createProgram(gl, fullscreenQuadVertex, blendFragment);
    this.initShaders();
    this.maskTexture = gl.createTexture();
    this.identityLutTexture = this.createIdentityLut();
  }

  /** Build a 256×1 RGBA identity LUT (value[i]=i). Curves channels
   *  without a real LUT bind this so the shader samples a passthrough,
   *  saving a per-frame texture alloc for inactive channels. */
  private createIdentityLut(): WebGLTexture {
    const { gl } = this;
    const tex = createTexture(gl, 256, 1);
    const data = new Uint8Array(256 * 4);
    for (let j = 0; j < 256; j++) {
      data[j * 4] = j; data[j * 4 + 1] = j; data[j * 4 + 2] = j; data[j * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  private createFBO(width: number, height: number): FBO {
    const { gl } = this;
    const texture = createTexture(gl, width, height);
    const framebuffer = createFramebuffer(gl, texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture };
  }

  /** Internal format for the ping-pong FBO textures, by precision mode.
   *  RGBA16F (half-float) in float mode → headroom + ~11-bit precision;
   *  RGBA8 otherwise (the unchanged 8-bit path). */
  private fboFormat(): { internal: number; format: number; type: number } {
    const { gl } = this;
    if (this.floatMode && this.floatSupported) {
      return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    }
    return { internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
  }

  private resizeFBOs(width: number, height: number): void {
    const { gl } = this;
    const { internal, format, type } = this.fboFormat();
    // Resize textures in place. Recreating the FBO + texture pair every
    // zoom-octave cost 10–50 ms at 4K because gl.createTexture allocates
    // GPU storage; texImage2D reuses the existing storage handle.
    for (const fbo of [this.fboA, this.fboB, this.fboC, this.fboD]) {
      gl.bindTexture(gl.TEXTURE_2D, fbo.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
    }
    this.fboFloat = this.floatMode && this.floatSupported;
    this.outputCanvas.width = width;
    this.outputCanvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  /** Re-allocate the FBO textures when the precision mode changed but the size
   *  didn't (e.g. switching from a float RAW layer to an 8-bit layer of the
   *  same dimensions). */
  private ensureFBOFormat(): void {
    const want = this.floatMode && this.floatSupported;
    if (this.fboFloat === want) return;
    if (this.width > 0 && this.height > 0) {
      this.resizeFBOs(this.width, this.height);
    } else {
      this.fboFloat = want;
    }
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
        gl.uniform1f(gl.getUniformLocation(program, 'u_whites'), engineUniformValue('whites', (p.whites as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_blacks'), engineUniformValue('blacks', (p.blacks as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_vibrance'), engineUniformValue('vibrance', (p.vibrance as number) ?? 0));
      },
    });

    // HSL targeted colour
    const hslProgram = createProgram(gl, fullscreenQuadVertex, hslFragment);
    const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
    this.shaders.set('hsl', {
      program: hslProgram,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        HSL_BANDS.forEach((band, i) => {
          gl.uniform1f(gl.getUniformLocation(program, `u_hslHue[${i}]`), engineUniformValue(`${band}_hue`, (p[`${band}_hue`] as number) ?? 0));
          gl.uniform1f(gl.getUniformLocation(program, `u_hslSat[${i}]`), engineUniformValue(`${band}_sat`, (p[`${band}_sat`] as number) ?? 0));
          gl.uniform1f(gl.getUniformLocation(program, `u_hslLum[${i}]`), engineUniformValue(`${band}_lum`, (p[`${band}_lum`] as number) ?? 0));
        });
      },
    });

    // Sharpen (single-pass unsharp)
    const sharpenProgram = createProgram(gl, fullscreenQuadVertex, sharpenFragment);
    this.shaders.set('sharpen', {
      program: sharpenProgram,
      needsTexel: true,
      setUniforms: (gl, program, adj) => {
        gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), engineUniformValue('amount', (adj.params.amount as number) ?? 0));
      },
    });

    // Gaussian blur (separable: H then V)
    const blurProgram = createProgram(gl, fullscreenQuadVertex, blurFragment);
    this.shaders.set('blur', {
      program: blurProgram,
      setUniforms: () => {},  // uniforms set inside renderInto per sub-pass
      renderInto: (ctx, adj) => {
        const { gl, inputTexture, targetFramebuffer, scratchA, texel, drawQuad } = ctx;
        const radius = engineUniformValue('radius', (adj.params.radius as number) ?? 0);
        const runPass = (inTex: WebGLTexture, outFb: WebGLFramebuffer | null, dir: [number, number]) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, outFb);
          gl.viewport(0, 0, ctx.width, ctx.height);
          gl.useProgram(blurProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, inTex);
          gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_texture'), 0);
          gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_texel'), texel[0], texel[1]);
          gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_direction'), dir[0], dir[1]);
          gl.uniform1f(gl.getUniformLocation(blurProgram, 'u_radius'), radius);
          gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_useMask'), 0);
          drawQuad();
        };
        runPass(inputTexture, scratchA.framebuffer, [texel[0], 0]);  // horizontal → scratchA
        runPass(scratchA.texture, targetFramebuffer, [0, texel[1]]); // vertical → target
      },
    });

    // Clarity (large-radius unsharp = blur then combine). Reuses the blur
    // program declared just above (same initShaders scope) via closure.
    const clarityProgram = createProgram(gl, fullscreenQuadVertex, clarityFragment);
    this.shaders.set('clarity', {
      program: clarityProgram,
      setUniforms: () => {},
      renderInto: (ctx, adj) => {
        const { gl, inputTexture, targetFramebuffer, scratchA, scratchB, texel, drawQuad } = ctx;
        const amount = engineUniformValue('amount', (adj.params.amount as number) ?? 0);
        const radius = 0.5; // fixed large radius for local-contrast
        const blurPass = (inTex: WebGLTexture, outFb: WebGLFramebuffer | null, dir: [number, number]) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, outFb);
          gl.viewport(0, 0, ctx.width, ctx.height);
          gl.useProgram(blurProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, inTex);
          gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_texture'), 0);
          gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_texel'), texel[0], texel[1]);
          gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_direction'), dir[0], dir[1]);
          gl.uniform1f(gl.getUniformLocation(blurProgram, 'u_radius'), radius);
          gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_useMask'), 0);
          drawQuad();
        };
        blurPass(inputTexture, scratchA.framebuffer, [texel[0], 0]);   // H → scratchA
        blurPass(scratchA.texture, scratchB.framebuffer, [0, texel[1]]); // V → scratchB (blurred)
        // Combine original (inputTexture) + blurred (scratchB) → target
        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
        gl.viewport(0, 0, ctx.width, ctx.height);
        gl.useProgram(clarityProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        gl.uniform1i(gl.getUniformLocation(clarityProgram, 'u_texture'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, scratchB.texture);
        gl.uniform1i(gl.getUniformLocation(clarityProgram, 'u_blurred'), 1);
        gl.uniform1f(gl.getUniformLocation(clarityProgram, 'u_amount'), amount);
        gl.uniform1i(gl.getUniformLocation(clarityProgram, 'u_useMask'), 0);
        drawQuad();
      },
    });

    // Grain (procedural noise on luminance)
    const grainProgram = createProgram(gl, fullscreenQuadVertex, grainFragment);
    this.shaders.set('grain', {
      program: grainProgram,
      needsTexel: true,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), engineUniformValue('amount', (p.amount as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_size'), engineUniformValue('size', (p.size as number) ?? 100));
        gl.uniform1f(gl.getUniformLocation(program, 'u_roughness'), engineUniformValue('roughness', (p.roughness as number) ?? 50));
      },
    });

    // Vignette (radial darken/brighten)
    const vignetteProgram = createProgram(gl, fullscreenQuadVertex, vignetteFragment);
    this.shaders.set('vignette', {
      program: vignetteProgram,
      needsTexel: true,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), engineUniformValue('amount', (p.amount as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_midpoint'), engineUniformValue('midpoint', (p.midpoint as number) ?? 50));
        gl.uniform1f(gl.getUniformLocation(program, 'u_feather'), engineUniformValue('feather', (p.feather as number) ?? 50));
        gl.uniform1f(gl.getUniformLocation(program, 'u_roundness'), engineUniformValue('roundness', (p.roundness as number) ?? 0));
      },
    });

    // Split-toning (two-tone luma-weighted tint)
    const splitToneProgram = createProgram(gl, fullscreenQuadVertex, splitToneFragment);
    this.shaders.set('splitTone', {
      program: splitToneProgram,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        gl.uniform1f(gl.getUniformLocation(program, 'u_shadowHue'), engineUniformValue('shadow_hue', (p.shadow_hue as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_shadowSat'), engineUniformValue('shadow_sat', (p.shadow_sat as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_highlightHue'), engineUniformValue('highlight_hue', (p.highlight_hue as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_highlightSat'), engineUniformValue('highlight_sat', (p.highlight_sat as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_balance'), engineUniformValue('balance', (p.balance as number) ?? 0));
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
        const channels = ['rgb', 'red', 'green', 'blue'] as const;
        // For each channel: if the adjustment supplies a LUT, reuse a
        // persistent per-(adjustment,channel) texture and re-upload pixels
        // onto it; if not, bind the shared identity LUT. We previously
        // allocated four fresh textures every frame (240 alloc/dealloc/s
        // at 60 fps with curves active).
        channels.forEach((ch, i) => {
          const lut = p[ch] as Float32Array | undefined;
          const unit = i + 1;
          gl.activeTexture(gl.TEXTURE0 + unit);
          if (lut) {
            const key = `${adj.id}:${ch}`;
            let tex = this.curvesLutTextures.get(key);
            if (!tex) {
              tex = createTexture(gl, 256, 1);
              this.curvesLutTextures.set(key, tex);
            }
            const data = new Uint8Array(256 * 4);
            for (let j = 0; j < 256; j++) {
              const v = Math.round(Math.max(0, Math.min(255, lut[j] * 255)));
              data[j * 4] = v; data[j * 4 + 1] = v; data[j * 4 + 2] = v; data[j * 4 + 3] = 255;
            }
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
          } else {
            gl.bindTexture(gl.TEXTURE_2D, this.identityLutTexture);
          }
          gl.uniform1i(gl.getUniformLocation(program, `u_lut_${ch}`), unit);
        });
        return []; // Persistent textures — drawPass does not delete.
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

    // Kelvin white balance shader.
    //
    // The canonical (and toolrail) param name is `kelvin` — absolute Kelvin
    // value in 2000-10000, neutral 6500. Fused-template bindings (warm_grade,
    // cast_correct, golden_hour, …) historically write a DELTA into a
    // `temperature` param (range ±N around 6500) — that's what their
    // resolvers emit and what `backend/app/state/preview_renderer.py`
    // consumes. The two name conventions never overlap on a single node, so
    // we honour whichever the widget actually wrote: prefer absolute
    // `kelvin`, else translate `temperature` to absolute via `6500 + delta`.
    const kelvinProgram = createProgram(gl, fullscreenQuadVertex, kelvinFragment);
    this.shaders.set('kelvin', {
      program: kelvinProgram,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        const kelvinAbs = p.kelvin as number | undefined;
        const tempDelta = p.temperature as number | undefined;
        const value =
          kelvinAbs !== undefined
            ? kelvinAbs
            : tempDelta !== undefined
            ? 6500 + tempDelta
            : 6500;
        gl.uniform1f(gl.getUniformLocation(program, 'u_kelvin'), engineUniformValue('kelvin', value));
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

        // No drawPass cleanup hook for 3D textures; cache lives across
        // frames and is freed via clearLutCache / dispose.
        return [];
      },
    });
  }

  /** Upload `source` as the input texture for the next render.
   *
   *  `dirty` (default true): re-upload pixels even when `source` is the
   *  same object as last call. Callers that know nothing has changed
   *  since the last `setSource` (e.g. only an adjustment param moved)
   *  can pass `false` to skip the upload entirely — a 4 K full-canvas
   *  reupload is ~100 MB and used to dominate frame time. */
  setSource(
    source: HTMLCanvasElement | HTMLImageElement | OffscreenCanvas | ImageBitmap,
    dirty = true,
  ): void {
    const { gl } = this;

    // 8-bit source ⇒ leave float mode; FBOs revert to RGBA8.
    this.floatMode = false;

    const w = source.width;
    const h = source.height;

    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.resizeFBOs(w, h);
    } else {
      this.ensureFBOFormat();
    }

    if (this.sourceTexture === null) {
      this.sourceTexture = createTexture(gl, w, h, source as TexImageSource);
      this.sourceIdentity = source as unknown as object;
      return;
    }
    // Reuse the existing texture handle.
    if (!dirty && this.sourceIdentity === (source as unknown as object)) {
      return; // No pixel change requested; the texture is still current.
    }
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.sourceIdentity = source as unknown as object;
  }

  /** Whether the high-bit-depth (RGBA16F) path is available on this GPU. */
  supportsFloat(): boolean {
    return this.floatSupported;
  }

  /**
   * Upload an RGBA-16 image as a float (RGBA16F) source and switch the pipeline
   * into float mode, so the adjustment chain carries headroom (>1.0 survives
   * between passes) and ~11-bit precision before the final 8-bit present.
   * Returns false when float isn't supported — the caller should fall back to
   * the 8-bit `setSource` path.
   *
   * `UNPACK_FLIP_Y_WEBGL` is ignored for typed-array uploads, so we flip rows
   * during the uint16→float32 normalise to match the 8-bit canvas orientation.
   */
  setHiBitSource(img: HiBitImage, dirty = true): boolean {
    const { gl } = this;
    if (!this.floatSupported) return false;

    this.floatMode = true;
    const w = img.width;
    const h = img.height;
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.resizeFBOs(w, h);
    } else {
      this.ensureFBOFormat();
    }

    if (!dirty && this.sourceIdentity === (img as unknown as object) && this.sourceTexture) {
      return true;
    }

    // Normalise uint16 (0..65535) → float (0..1), flipping vertically.
    const src = img.data;
    const f = new Float32Array(w * h * 4);
    const inv = 1 / 65535;
    for (let y = 0; y < h; y++) {
      const sy = h - 1 - y;
      for (let x = 0; x < w; x++) {
        const si = (sy * w + x) * 4;
        const di = (y * w + x) * 4;
        f[di] = src[si] * inv;
        f[di + 1] = src[si + 1] * inv;
        f[di + 2] = src[si + 2] * inv;
        f[di + 3] = src[si + 3] * inv;
      }
    }

    if (this.sourceTexture === null) this.sourceTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Upload FLOAT data into an RGBA16F texture (driver narrows to half).
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, f);
    this.sourceIdentity = img as unknown as object;
    return true;
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
        if (shader.renderInto) {
          shader.renderInto({
            gl, inputTexture: currentTex, targetFramebuffer: target,
            scratchA: this.fboC, scratchB: this.fboD,
            width: this.width, height: this.height,
            texel: [1 / this.width, 1 / this.height],
            drawQuad: () => this.drawQuad(),
          }, adj);
        } else {
          const temps = this.drawPass(currentTex, target, shader, adj);
          for (const t of temps) gl.deleteTexture(t);
        }
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

  private drawQuad(): void {
    const { gl } = this;
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
      if (shader.needsTexel) {
        gl.uniform2f(gl.getUniformLocation(shader.program, 'u_texel'), 1 / this.width, 1 / this.height);
      }
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
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_whites'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_blacks'), 0);
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
      // Same key shape as the persistent curves cache.
      for (const key of Array.from(this.curvesLutTextures.keys())) {
        if (key.startsWith(`${adjustmentId}:`)) {
          gl.deleteTexture(this.curvesLutTextures.get(key)!);
          this.curvesLutTextures.delete(key);
        }
      }
    } else {
      for (const tex of this.lutTextureCache.values()) gl.deleteTexture(tex);
      this.lutTextureCache.clear();
      for (const tex of this.curvesLutTextures.values()) gl.deleteTexture(tex);
      this.curvesLutTextures.clear();
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
    this.deleteFBO(this.fboD);
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    if (this.maskTexture) gl.deleteTexture(this.maskTexture);
    if (this.identityLutTexture) gl.deleteTexture(this.identityLutTexture);
    for (const shader of this.shaders.values()) {
      gl.deleteProgram(shader.program);
    }
    this.shaders.clear();
    gl.deleteProgram(this.blendProgram);
    this.clearLutCache();
  }
}
