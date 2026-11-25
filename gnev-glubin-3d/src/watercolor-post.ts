import * as T from 'three';

type WatercolorSettings = {
  enabled: boolean;
  time: number;
  wrath: number;
  brush: number;
  grain: number;
  relief: number;
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uCssSize;
  uniform float uTime, uWrath, uBrush, uGrain, uRelief;
  varying vec2 vUv;

  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x),
      f.y
    );
  }

  float lightness(vec3 color) {
    return dot(color, vec3(.2126, .7152, .0722));
  }

  void main() {
    vec2 px = vUv * uCssSize;
    vec2 uvPerPixel = 1.0 / uCssSize;
    vec4 source = texture2D(tScene, vUv);
    vec3 center = source.rgb;

    // The slowly drifting field changes stroke width and direction without
    // making objects themselves drag around the screen.
    vec2 drift = vec2(.18, -.11) * uTime;
    float current = noise(px * vec2(.009, .016) + drift);
    float bristle = noise(vec2(px.x * .035 + px.y * .032, px.y * .21 - px.x * .12) - drift * 1.7);
    float angle = mix(.26, .64, uWrath) + (current - .5) * 1.56;
    vec2 direction = vec2(cos(angle), sin(angle));
    vec2 along = direction * uvPerPixel;
    vec2 across = vec2(-direction.y, direction.x) * uvPerPixel;
    float extent = uBrush * mix(4.8, 12.5, current) * mix(.62, 1.26, bristle);
    float tooth = noise(px * .92) - .5;
    vec2 stroke = vUv + across * uBrush * (bristle - .5) * 2.8;

    vec3 a = texture2D(tScene, stroke - along * extent).rgb;
    vec3 b = texture2D(tScene, stroke - along * extent * .52).rgb;
    vec3 c = texture2D(tScene, stroke + along * extent * .42).rgb;
    vec3 d = texture2D(tScene, stroke + along * extent * .88).rgb;
    vec3 edgeDark = texture2D(tScene, vUv - across * (1.1 + .30 * uBrush)).rgb;
    vec3 edgeLight = texture2D(tScene, vUv + across * (1.1 + .30 * uBrush)).rgb;
    float edge = lightness(edgeLight - edgeDark);

    vec3 wash = (a + d) * .115 + (b + c) * .21 + center * .35;
    float contour = smoothstep(.05, .27, abs(edge));
    float brushMix = min(.90, uBrush * 1.08) * mix(1.0, .52, contour);
    vec3 pigment = mix(center, wash, brushMix);
    pigment *= 1.0 + (bristle - .50) * (.14 * uBrush);

    // Designed to remain visible on midtones without turning highlights white
    // or visibly changing the contrast of the rest of the scene.
    float paper = tooth * .095 + (noise(px * .46 + vec2(11.5, 27.1)) - .5) * .052;
    float emboss = clamp(edge, -.19, .19) * .28 * uRelief;
    float pooling = 1.0 - smoothstep(.13, .44, lightness(pigment));
    vec3 color = pigment * (1.0 + paper * uGrain * (1.0 + pooling * .45));
    color += (paper * uGrain * .031 + emboss) * vec3(1.0, .985, .944);

    gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createWatercolorPost() {
  const screen = new T.Scene();
  const screenCamera = new T.Camera();
  const triangle = new T.BufferGeometry();
  triangle.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  triangle.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const uniforms = {
    tScene: { value: null as T.Texture | null },
    uCssSize: { value: new T.Vector2(1, 1) },
    uTime: { value: 0 },
    uWrath: { value: 0 },
    uBrush: { value: 0 },
    uGrain: { value: 0 },
    uRelief: { value: 0 },
  };
  const material = new T.ShaderMaterial({
    name: 'Watercolor paper and pigment',
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const canvasTriangle = new T.Mesh(triangle, material);
  canvasTriangle.frustumCulled = false;
  screen.add(canvasTriangle);
  const drawingSize = new T.Vector2();
  let target: T.WebGLRenderTarget | undefined;

  function makeTarget(renderer: T.WebGLRenderer) {
    const canCaptureHdr = renderer.capabilities.isWebGL2
      ? renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')
      : renderer.extensions.has('EXT_color_buffer_half_float') && renderer.extensions.has('OES_texture_half_float_linear');
    const result = new T.WebGLRenderTarget(drawingSize.x, drawingSize.y, {
      type: canCaptureHdr ? T.HalfFloatType : T.UnsignedByteType,
      colorSpace: T.LinearSRGBColorSpace,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
    });
    result.texture.name = 'Watercolor scene color';
    return result;
  }

  function render(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.Camera, options: WatercolorSettings, captureDepth = false) {
    if (!options.enabled || !(options.brush || options.grain || options.relief)) {
      renderer.render(scene, camera);
      return;
    }

    renderer.getDrawingBufferSize(drawingSize);
    drawingSize.set(Math.max(1, drawingSize.x), Math.max(1, drawingSize.y));
    target ??= makeTarget(renderer);
    target.setSize(drawingSize.x, drawingSize.y);
    if (captureDepth && !target.depthTexture) {
      target.dispose();
      target.depthTexture = new T.DepthTexture(drawingSize.x, drawingSize.y, T.UnsignedIntType);
    }
    uniforms.tScene.value = target.texture;
    renderer.getSize(uniforms.uCssSize.value);
    uniforms.uCssSize.value.set(
      Math.max(1, renderer.domElement.clientWidth || uniforms.uCssSize.value.x),
      Math.max(1, renderer.domElement.clientHeight || uniforms.uCssSize.value.y),
    );
    uniforms.uTime.value = options.time;
    uniforms.uWrath.value = T.MathUtils.clamp(options.wrath, 0, 1);
    uniforms.uBrush.value = T.MathUtils.clamp(options.brush, 0, 1);
    uniforms.uGrain.value = T.MathUtils.clamp(options.grain, 0, 1);
    uniforms.uRelief.value = T.MathUtils.clamp(options.relief, 0, 1);

    const previousTarget = renderer.getRenderTarget();
    const previousCubeFace = renderer.getActiveCubeFace();
    const previousMipmapLevel = renderer.getActiveMipmapLevel();
    const previousScissor = renderer.getScissorTest();
    const autoClear = renderer.autoClear;
    const autoClearColor = renderer.autoClearColor;
    const autoClearDepth = renderer.autoClearDepth;
    try {
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderer.autoClear = renderer.autoClearColor = renderer.autoClearDepth = true;
      // In Three r160 an offscreen target receives linear, untonemapped color.
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
      renderer.setScissorTest(previousScissor);
      renderer.autoClear = autoClear;
      renderer.autoClearColor = autoClearColor;
      renderer.autoClearDepth = autoClearDepth;
    }
    renderer.render(screen, screenCamera);
    return captureDepth ? target.depthTexture ?? undefined : undefined;
  }

  function dispose() {
    target?.dispose();
    triangle.dispose();
    material.dispose();
  }

  return { render, dispose };
}
