export const screenFilterShader = `
uniform float uFilter, uFilterAmount;

float sfLuma(vec3 color) {
  return dot(color, vec3(.2126, .7152, .0722));
}

float sfHash(vec2 p) {
  vec3 v = fract(vec3(p.xyx) * .1031);
  v += dot(v, v.yzx + 33.33);
  return fract((v.x + v.y) * v.z);
}

float sfNoise(vec2 p) {
  vec2 tile = floor(p);
  vec2 f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(sfHash(tile), sfHash(tile + vec2(1., 0.)), f.x),
             mix(sfHash(tile + vec2(0., 1.)), sfHash(tile + vec2(1.)), f.x), f.y);
}

vec3 sfSample(vec2 uv) {
  vec2 edge = uPixel * .5;
  return sampleFrame(clamp(uv, edge, vec2(1.) - edge));
}

vec3 sfDisplay(vec3 color) {
  return sqrt(max(vec3(0.), color));
}

vec3 sfDisplayTap(vec2 uv) {
  return sfDisplay(sfSample(uv));
}

float sfLumaTap(vec2 uv) {
  return sfLuma(sfDisplayTap(uv));
}

float sfPrintLine(float coordinate, float width) {
  float distanceToLine = abs(fract(coordinate) - .5);
  float aa = max(fwidth(coordinate) * .44, .02);
  return 1. - smoothstep(max(0., width - aa), width + aa, distanceToLine);
}

vec3 sfLightBleed(vec2 uv) {
  vec3 tap = sfDisplayTap(uv);
  return tap * smoothstep(.28, .70, sfLuma(tap));
}

vec3 visualFilter(vec3 sceneColor, vec2 uv) {
  float strength = clamp(uFilterAmount, 0., 1.);
  if (uFilter < .5 || strength <= 0.) return sceneColor;

  vec3 source = sfDisplay(sceneColor);
  vec3 grade = source;
  float y = sfLuma(source);
  vec2 px = uv / uPixel;
  float grain = sfHash(floor(px)) - .5;

  if (uFilter < 1.5) {
    // Ektachrome-like contrast with a soft knee and a warm shoulder.
    float toe = smoothstep(.025, .46, y);
    float shoulder = smoothstep(.29, .94, y);
    float curve = y * (.76 + .43 * toe) - .14 * shoulder;
    vec3 dye = mix(vec3(.59, 1.08, 1.20), vec3(1.17, .99, .71), shoulder);
    grade = (vec3(curve) + (source - y) * 1.04) * dye;
    grade += vec3(.024, .039, .050) * (1. - toe) + grain * .059 * (1. - .57 * shoulder);
  } else if (uFilter < 2.5) {
    // The shoulder restores silver to foam and reflective stone.
    float midnight = pow(clamp(y * 1.07, 0., 1.), 1.56);
    float silver = smoothstep(.44, .91, y);
    grade = vec3(.037, .066, .119) + vec3(.50, .60, .67) * midnight
      + vec3(.31, .32, .29) * silver;
    grade += grain * .027;
  } else if (uFilter < 3.5) {
    float variation = grain * .037 + (sfNoise(px * .075) - .5) * .040;
    float glaze = y + variation;
    grade = mix(vec3(.067, .045, .034), vec3(.36, .15, .082), smoothstep(.21, .263, glaze));
    grade = mix(grade, vec3(.74, .34, .18), smoothstep(.392, .442, glaze));
    grade = mix(grade, vec3(.94, .60, .37), smoothstep(.62, .74, glaze));
    grade += vec3(.029, .018, .011) * grain;
  } else if (uFilter < 4.5) {
    vec2 dx = vec2(uPixel.x, 0.);
    vec2 dy = vec2(0., uPixel.y);
    float gx = sfLumaTap(uv + dx) - sfLumaTap(uv - dx);
    float gy = sfLumaTap(uv + dy) - sfLumaTap(uv - dy);
    float edge = smoothstep(.036, .17, length(vec2(gx, gy)));
    float angle = (px.x + px.y * .83) * .154 + sfNoise(px * .05) * .24;
    float secondAngle = (px.x - px.y * .74) * .159;
    float shade = 1. - smoothstep(.19, .76, y);
    float hatch = sfPrintLine(angle, .12) * .74 * smoothstep(.12, .63, shade)
      + sfPrintLine(secondAngle, .10) * .75 * smoothstep(.53, .86, shade);
    float ink = clamp(edge * .80 + hatch + shade * .23, 0., .98);
    vec3 paper = vec3(.94, .88, .73) + .046 * grain;
    grade = mix(paper, vec3(.114, .103, .078), ink);
    grade *= .84 + .16 * smoothstep(.06, .68, y);
  } else if (uFilter < 5.5) {
    vec2 stepX = vec2(uPixel.x, 0.);
    vec2 stepY = vec2(0., uPixel.y);
    vec3 glow = vec3(0.);
    for (int i = 0; i < 8; i++) {
      float angle = float(i) * .785398;
      vec2 radius = stepX * cos(angle) + stepY * sin(angle);
      glow += sfLightBleed(uv + radius * 5.) * .069;
      glow += sfLightBleed(uv + radius * 17.) * .054;
    }
    float spill = max(0., sfLuma(glow) - y * smoothstep(.32, .74, y) * .65);
    grade = source * vec3(1.07, .96, .83) * .92 + vec3(.097, .065, .063);
    grade += spill * vec3(1.00, .42, .32) + glow * vec3(.15, .12, .10);
  } else if (uFilter < 6.5) {
    vec2 center = uv - .5;
    float radius = length(center * vec2(1.13, 1.));
    float edge = smoothstep(.12, .68, radius);
    vec2 ripple = sin(center.yx * vec2(17., 12.) + vec2(.6, 2.)) * .0034 * edge;
    vec2 warped = uv + center * (.030 * edge) + ripple;
    vec2 dispersion = center * (.030 * edge);
    vec3 refracted = sfDisplayTap(warped);
    refracted.r = sfDisplayTap(warped + dispersion).r;
    refracted.b = sfDisplayTap(warped - dispersion).b;
    grade = refracted * mix(vec3(1.), vec3(.83, 1.06, 1.24), edge * .83);
    grade += vec3(.025, .073, .091) * edge;
  } else if (uFilter < 7.5) {
    vec2 field = (uv - vec2(.49, .52)) * vec2(1.22, 1.03);
    float shadow = smoothstep(.13, .76, length(field));
    float key = smoothstep(.20, .77, y);
    vec3 mauve = vec3(.103, .061, .173);
    vec3 rose = vec3(.94, .66, .64);
    grade = mix(mauve, rose, pow(clamp(y, 0., 1.), 1.43));
    grade += (source - y) * (.26 + .28 * key);
    grade *= 1.13 - .66 * shadow;
    grade += vec3(.052, .031, .036) * (1. - shadow) * key;
  } else if (uFilter < 8.5) {
    float pigment = sfNoise(px * vec2(.035, .094))
      * .62 + sfNoise(px * .21) * .38;
    float pores = smoothstep(.76, .95, sfHash(floor(px / 2.)));
    float pigmentValue = .38 + .55 * smoothstep(.00, .94, y);
    vec3 lime = vec3(pigmentValue + .060, pigmentValue + .023, pigmentValue - .049);
    grade = lime + (source - y) * vec3(.64, .56, .41);
    grade += (.15 * (pigment - .5) - .049 * pores + .030 * grain) * (1. - .32 * y);
  } else if (uFilter < 9.5) {
    float verdigris = smoothstep(-.02, .20, .62 * source.g + .38 * source.b - source.r);
    float warmed = smoothstep(.008, .21, source.r - source.b);
    float metal = smoothstep(.24, .84, y);
    vec3 oxide = mix(vec3(.037, .119, .099), vec3(.27, .73, .48), smoothstep(.08, .67, y));
    vec3 brass = mix(vec3(.18, .10, .038), vec3(1.02, .81, .35), metal);
    grade = mix(oxide, brass, clamp(.45 + .78 * warmed - .64 * verdigris, 0., 1.));
    grade += (source - y) * .31 + vec3(.058, .082, .047) * metal;
  } else if (uFilter < 10.5) {
    vec2 dx = vec2(uPixel.x, 0.);
    vec2 dy = vec2(0., uPixel.y);
    float nearLuma = (sfLumaTap(uv + dx * 2.) + sfLumaTap(uv - dx * 2.)
      + sfLumaTap(uv + dy * 2.) + sfLumaTap(uv - dy * 2.)) * .25;
    float farLuma = (sfLumaTap(uv + (dx + dy) * 7.) + sfLumaTap(uv - (dx + dy) * 7.)
      + sfLumaTap(uv + (dx - dy) * 7.) + sfLumaTap(uv - (dx - dy) * 7.)) * .25;
    float detail = clamp((y - nearLuma) * .72 + (y - farLuma) * .28, -.13, .19);
    float facets = max(.016, y * .89 + detail * .98 + .17 * smoothstep(.41, .86, y));
    grade = vec3(facets) + (source - y) * .85;
    grade *= mix(vec3(.74, 1.00, 1.27), vec3(1.09, 1.02, .96), smoothstep(.14, .79, y));
  } else {
    return sceneColor;
  }
  grade = max(vec3(0.), grade);
  // Blend in the same display-like space used by the presets, so bright
  // grades don't jump out of the shadows at the first slider step.
  vec3 blended = mix(source, grade, strength);
  return blended * blended;
}
`;
