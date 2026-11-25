import type { DataTexture, ShaderMaterial, Vector4 } from 'three';

export type LocationSurface = {
  map: DataTexture;
  bounds: Vector4;
  eye: Vector4;
  clarity: { value: number };
};

export function fitLocationSurface(material: ShaderMaterial, surface: LocationSurface | undefined, revealEye = false) {
  if (!surface) return;
  material.uniforms.uLocationMap = { value: surface.map };
  material.uniforms.uLocationRect = { value: surface.bounds };
  material.fragmentShader = `
uniform sampler2D uLocationMap;
uniform vec4 uLocationRect;
` + material.fragmentShader.replace(/void main\s*\(\s*\)\s*\{/, `$&
  vec2 locationUV = (vWorld.xz - uLocationRect.xy) / uLocationRect.zw;
  if (any(lessThan(locationUV, vec2(0.0))) || any(greaterThan(locationUV, vec2(1.0)))) discard;
  if (texture2D(uLocationMap, locationUV).b < .498) discard;
`);

  if (!revealEye || surface.eye.z <= 0) return;
  material.uniforms.uLocationEye = { value: surface.eye };
  material.uniforms.uLocationClarity = surface.clarity;
  material.fragmentShader = `
uniform vec4 uLocationEye;
uniform float uLocationClarity;
` + material.fragmentShader.replace(/(gl_FragColor\s*=\s*[^;]+;)/, `$1
  float eyeDistance = length((vWorld.xz - uLocationEye.xy) / uLocationEye.zw);
  gl_FragColor.a = 1.0 - .68 * uLocationClarity * (1.0 - smoothstep(.30, 1.25, eyeDistance));
`);
  material.transparent = true;
  material.depthWrite = false;
}
