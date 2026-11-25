export const microShader = `
uniform float uMicro[10];
uniform float uBottomDepth, uHasLamp;
vec3 microViewRay;
uniform vec3 uMicroLamp;

vec2 microHash2(vec2 p) {
  return vec2(hash(p + 2.13), hash(p - 8.47));
}

vec2 microTurn(vec2 p, float angle) {
  vec2 axis = vec2(cos(angle), sin(angle));
  return vec2(dot(p, axis), dot(p, vec2(-axis.y, axis.x)));
}

vec3 microCoast(vec2 p) {
  vec2 uv = (p - uBounds.xy) / uBounds.zw;
  if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return vec3(0.);
  return texture2D(uCoast, uv).rgb;
}

vec3 microRayAt(vec3 world) {
  return uPerspective > .5 ? normalize(world - uCameraPosition) : uCameraDirection;
}

float microPlaneOffset(vec3 world, vec3 ray, float level) {
  float vertical = ray.y < 0. ? min(-.001, ray.y) : max(.001, ray.y);
  return (level - world.y) / vertical;
}

vec2 microPlane(vec3 world, float level) {
  return world.xz + microViewRay.xz * microPlaneOffset(world, microViewRay, level);
}

bool microInFront(vec3 world, float level, float tolerance) {
  if (abs(microViewRay.y) < .001) return false;
  float offset = microPlaneOffset(world, microViewRay, level);
  if (offset > tolerance) return false;
  return uPerspective < .5 || dot(world - uCameraPosition, microViewRay) + offset > .12;
}

float microWaterCoverage(vec3 world, vec3 ray, vec3 coast) {
  return smoothstep(.50, .69, coast.b) * (1. - smoothstep(.24, .58, world.y))
    * smoothstep(.001, .042, -ray.y);
}

vec2 microBillboard(vec2 plane, vec2 center) {
  vec2 across = normalize(vec2(-uCameraDirection.z, uCameraDirection.x));
  vec2 along = vec2(-across.y, across.x);
  vec2 d = plane - center;
  return vec2(dot(d, across), dot(d, along) * max(.13, abs(microViewRay.y)));
}

float microSoftEdge(float radius, float edge, float feather) {
  return 1. - smoothstep(edge - feather, edge + feather, radius);
}

float microEllipse(vec2 p, vec2 radii, float edge) {
  return microSoftEdge(length(p / radii), 1., edge);
}

vec2 microWaterWarp(vec2 point, float t) {
  float first = sin(dot(point, vec2(1.66, .91)) + t * 1.14);
  float second = sin(dot(point, vec2(-1.00, 2.12)) - t * .89);
  return vec2(first + .35 * second, second - .41 * first);
}

vec3 microRefract(vec3 color, vec3 world, float amount, float t, float mask, float quietZone) {
  vec2 p = world.xz;
  vec2 warp = microWaterWarp(p, t);
  vec2 uv = clamp(vUv + warp * uPixel * (4. + amount * 7.), uPixel * 1.5, 1. - uPixel * 1.5);
  vec3 hit = positionAt(uv, texture2D(uDepth, uv).x);
  vec3 ray = microRayAt(hit);
  vec2 waterHit = hit.xz + ray.xz * microPlaneOffset(hit, ray, 0.);
  float adjacentWater = microWaterCoverage(hit, ray, microCoast(waterHit))
    * mix(1., smoothstep(.55, 1.75, length(waterHit - uBobber)), uHasBobber);
  vec3 shift = frameLinear(texture2D(uFrame, uv).rgb) - frameLinear(texture2D(uFrame, vUv).rgb);
  color += shift * adjacentWater * mask * min(1., amount * .90) * quietZone;
  vec2 floorP = microPlane(world, -.86) + warp * .31;
  float a = sin(dot(floorP, vec2(4.27, 1.39)) - t * 1.71);
  float b = sin(dot(floorP, vec2(-1.21, 5.05)) + t * 1.37);
  float streak = smoothstep(1.08, 1.91, a + .68 * b);
  streak += .38 * smoothstep(1.35, 1.94, -a + b);
  float patches = smoothstep(.26, .71, noise(floorP * .39 + t * .085));
  return color + vec3(.62, .93, .83) * streak * patches * mask * quietZone * amount * .52;
}

vec3 microShards(vec3 color, vec2 bedP, float mask, float day, float t) {
  vec2 field = (bedP + microWaterWarp(bedP, t) * .085) * 1.62;
  vec2 cell = floor(field);
  float h = hash(cell + 23.);
  vec2 q = microTurn(fract(field) - (.25 + .51 * microHash2(cell)), h * 6.283);
  vec2 sharp = q / vec2(.16 + h * .14, .085 + h * .10);
  float facets = max(abs(sharp.y) + sharp.x * .65, -sharp.x * 1.20);
  float profile = microSoftEdge(facets, .86, .16);
  float roundPebble = microEllipse(q + vec2(.027, .016), vec2(.107, .064), .18);
  float scattered = step(.52, h) * (.23 + .77 * smoothstep(.28, .76, noise(cell * .24)));
  float layer = max(profile * smoothstep(.58, .77, h), roundPebble * .87) * scattered;
  vec3 ceramic = mix(vec3(.070, .135, .128), vec3(.45, .25, .135), day * .75 + .16);
  ceramic = mix(ceramic, vec3(.41, .52, .43), step(.83, h) * .77);
  color *= 1. - layer * mask * .31;
  color += ceramic * layer * mask * (.64 + .36 * smoothstep(-.1, .07, q.x));
  return color;
}

vec3 microSilt(vec3 color, vec2 bedP, float mask, float day, float t) {
  vec2 flow = microTurn(bedP, -.38) * vec2(.61, 2.26);
  flow.x -= t * .52;
  float broad = noise(flow * vec2(.6, .54) + vec2(-t * .14, .9));
  flow.y += noise(flow * .38) * 2.7;
  float stream = smoothstep(.42, .76, cloud(flow)) * smoothstep(.34, .69, broad);
  float curls = noise(flow * 3.84 + vec2(t * .39, -2.4));
  float grains = smoothstep(.64, .91, curls) * stream;
  vec3 siltTint = mix(vec3(.42, .49, .48), vec3(.69, .48, .27), day);
  return mix(color, color * .66 + siltTint * (.29 + .38 * grains), stream * mask * .85);
}

vec3 microShoal(vec3 color, vec3 world, float mask, float t) {
  for (int group = 0; group < 3; group++) {
    float index = float(group);
    float phase = t * (.28 + index * .042) + index * 2.33;
    float level = -1.19 - index * .43 + .30 * sin(phase);
    vec2 spread = vec2(sin(index * 3.3 + .61), cos(index * 2.4 + .88));
    vec2 center = mix(uAnchor, uBoat, .38) + spread * vec2(6.2, 7.6);
    center += vec2(sin(phase) * 3.9, cos(phase) * 3.3);
    vec2 plane = microPlane(world, level);
    if (distance(plane, center) < 4.1) {
      vec3 depthCoast = microCoast(plane);
      float visible = smoothstep(-level - .14, -level + .32, depthCoast.g * uBottomDepth)
        * smoothstep(.46, .69, depthCoast.b) * (1. - index * .18);
      float heading = atan(-sin(phase) * 3.3, cos(phase) * 3.9);
      vec2 local = microTurn(plane - center, heading);
      float bodies = 0.;
      float flash = 0.;
      for (int fish = 0; fish < 8; fish++) {
        float n = float(fish);
        float tailBeat = sin(t * (4.1 + n * .23) + n * 2.21);
        vec2 slot = vec2(1.36 - n * .31, sin(n * 2.4 + index) * (.27 + n * .15));
        vec2 q = local - slot - vec2(.11 * tailBeat, .18 * sin(t * .68 + n * 2.3));
        q = microTurn(q, .19 * sin(n * 1.73 + t * .55));
        float body = microEllipse(q, vec2(.25 + mod(n, 3.) * .044, .107), .26);
        float tail = microSoftEdge(abs(q.y + tailBeat * .042) * 1.7 + (q.x + .33) * .60, .116, .030)
          * smoothstep(-.48, -.43, q.x) * (1. - smoothstep(-.26, -.21, q.x));
        float shine = pow(.5 + .5 * sin(phase * 3. + n * 1.24), 8.0) * body;
        bodies = max(bodies, max(body, tail * .79));
        flash = max(flash, shine);
      }
      color = mix(color, vec3(.023, .077, .093), bodies * visible * mask * .69);
      color += vec3(.30, .67, .84) * flash * visible * mask * .92;
    }
  }
  return color;
}

vec3 microBubbles(vec3 color, vec3 world, float mask, float t) {
  vec2 field = (world.xz + vec2(1.4, -2.8)) * .24;
  vec2 cell = floor(field);
  float rings = 0.;
  float pin = 0.;
  for (int ix = -1; ix <= 1; ix++) {
    for (int iz = -1; iz <= 1; iz++) {
      vec2 originCell = cell + vec2(float(ix), float(iz));
      float h = hash(originCell + 18.2);
      if (h < .66) continue;
      vec2 origin = (originCell + .25 + .5 * microHash2(originCell + 1.43)) / .24 - vec2(1.4, -2.8);
      if (distance(world.xz, origin) > 4.9) continue;
      vec3 originCoast = microCoast(origin);
      float floorDepth = originCoast.g * uBottomDepth;
      if (floorDepth < 1.05 || originCoast.b < .87) continue;
      for (int bead = 0; bead < 5; bead++) {
        float n = float(bead);
        float life = fract(t * (.23 + h * .11) + n * .17 + h * 12.4);
        float level = mix(-min(2.50, floorDepth - .16), -.045, life);
        vec2 center = origin + vec2(sin(n + life * 6.0) * .19, life * .37);
        vec2 q = microBillboard(microPlane(world, level), center);
        float radius = .047 + life * .068 + mod(n, 2.) * .027;
        float fade = smoothstep(.05, .27, life) * (1. - smoothstep(.87, 1.0, life));
        float r = length(q);
        float beadRim = microSoftEdge(abs(r - radius), .026, .013);
        float highlight = microEllipse(q - vec2(-.48, .54) * radius, vec2(.052, .038), .34);
        rings = max(rings, beadRim * fade * (.36 + .56 * life));
        pin = max(pin, highlight * fade);
      }
    }
  }
  return color + (rings * vec3(.29, .66, .82) + pin * vec3(.45, .76, .82)) * mask * .74;
}

vec3 microPlankton(vec3 color, vec2 p, float mask, float t, float danger) {
  vec2 heading = vec2(-uHeading.y, uHeading.x);
  vec2 offset = p - uBoat;
  float behind = -dot(offset, uHeading);
  float flank = abs(dot(offset, heading));
  float wake = exp(-pow((flank - (.50 + max(0., behind) * .24)) * 1.44, 2.))
    * smoothstep(.68, 1.62, behind) * (1. - smoothstep(5.8, 11.6, behind));
  vec2 field = microTurn(p - uWind * t * .09, .33) * vec2(2.9, 1.85);
  vec2 cell = floor(field);
  vec2 q = fract(field) - .24 - .52 * microHash2(cell);
  float h = hash(cell + 66.7);
  float pulse = pow(.5 + .5 * sin(t * (1.4 + h * 2.5) + h * 31.2), 4.0);
  float fleck = microEllipse(q, vec2(.074 + wake * .14, .070), .35);
  float halo = microEllipse(q, vec2(.19 + wake * .17, .18), .70);
  float brightness = (.15 + .85 * wake) * step(.23, h) * mask * (.63 + danger * .37);
  return color + (vec3(.090, .94, 1.14) * fleck + vec3(.024, .16, .28) * halo) * brightness * pulse;
}

vec3 microLeaves(vec3 color, vec2 p, vec3 coast, float mask, float t) {
  vec2 field = (p - uWind * t * .14) * .56;
  vec2 cell = floor(field);
  float h = hash(cell - 24.);
  vec2 local = fract(field) - .25 - microHash2(cell) * .50;
  local.y += .07 * sin(t * .96 + h * 38.4);
  vec2 q = microTurn(local, h * 12.28 + sin(t * .67 + h * 9.67) * .64);
  float lengthScale = .12 + h * .065;
  float bend = sin(q.x * 8. + h * 6.0) * .027;
  float leafHalf = (.060 + h * .022) * max(0., 1. - pow(abs(q.x) / lengthScale, 1.6));
  float leaf = (1. - smoothstep(max(.0, leafHalf - .018), leafHalf + .014, abs(q.y - bend)))
    * (1. - smoothstep(lengthScale - .016, lengthScale + .018, abs(q.x)));
  float rib = microSoftEdge(abs(q.y - bend), .009, .007);
  float flick = pow(.5 + .5 * sin(h * 24. + t * 1.16), 3.0);
  float bank = (1. - smoothstep(.36, .98, coast.g)) * step(.64, h);
  vec3 face = mix(vec3(.13, .18, .038), vec3(.58, .61, .31), .24 + flick * .64);
  face += vec3(.24, .24, .073) * rib;
  float shadow = microEllipse(q - vec2(.012, .052), vec2(.16, .065), .32);
  return mix(color * (1. - shadow * mask * bank * .38), face, leaf * mask * bank * .92);
}

vec3 microSpray(vec3 color, vec3 world, float quietZone, float t) {
  float spray = 0.;
  for (int band = 0; band < 3; band++) {
    float n = float(band);
    float level = .20 + n * .46;
    if (!microInFront(world, level, .12)) continue;
    vec2 point = microPlane(world, level);
    vec2 field = microTurn(point - uWind * (t * (1.03 + n * .58) + n * .57), atan(uWind.y, uWind.x));
    field *= vec2(1.40, 2.64);
    field += vec2(9.13, 3.03) * n;
    vec2 cell = floor(field);
    float h = hash(cell + n * 31. + 47.2);
    vec2 q = fract(field) - .22 - .55 * microHash2(cell + 3.0);
    float droplet = microEllipse(q, vec2(.17 + h * .16, .065 + h * .034), .31);
    vec3 seam = microCoast(point - uWind * (level * 1.72));
    float breakers = smoothstep(.09, .38, seam.r) * (1. - smoothstep(.47, .81, seam.r));
    float gust = smoothstep(.38, .76, noise(point * .33 - uWind * t * .63));
    spray += droplet * step(.53 + n * .093, h) * breakers * gust * (1. - n * .22);
  }
  return color + spray * vec3(.69, .92, 1.15) * quietZone * .76;
}

vec3 microPollen(vec3 color, vec3 world, float t, float day) {
  float grain = 0.;
  float halo = 0.;
  for (int layer = 0; layer < 2; layer++) {
    float n = float(layer);
    float level = .83 + n * 1.80;
    if (!microInFront(world, level, .03)) continue;
    vec2 plane = microPlane(world, level);
    vec2 field = (plane - uWind * t * (.23 + n * .13)) * (1.65 - n * .43) + vec2(4.63, 13.11) * n;
    vec2 cell = floor(field);
    float h = hash(cell + 8.1 + n * 43.3);
    vec2 q = fract(field) - .22 - .55 * microHash2(cell);
    q.x += sin(t * .59 + h * 19.1) * .070;
    q.y += cos(t * .76 + h * 32.5) * .100;
    float sun = smoothstep(.41, .74, cloud(plane * .21 - uWind * t * .04));
    float visibility = step(.76 + n * .13, h) * sun * (.53 + .47 * sin(h * 74.32 + t * .85));
    float size = .047 + h * .040 + n * .035;
    grain += microEllipse(q, vec2(size, size * 1.38), .46 + n * .27) * visibility;
    halo += microEllipse(q, vec2(size * 2.9, size * 3.13), .7) * visibility;
  }
  return color + (grain * vec3(.80, .53, .22) + halo * vec3(.15, .11, .039)) * mix(.60, 1., day);
}

vec3 microMoths(vec3 color, vec3 world, float t, float danger) {
  if (uHasLamp < .5 || distance(microPlane(world, uMicroLamp.y + .64), uMicroLamp.xz) > 4.4) return color;
  float trail = 0.;
  float glow = 0.;
  for (int moth = 0; moth < 16; moth++) {
    float n = float(moth);
    float h = hash(vec2(n, 55.4));
    float orbit = t * (.76 + h * 1.11) + n * 2.4;
    float radius = .29 + h * 2.06;
    float level = uMicroLamp.y + .27 + h * 1.12 + sin(orbit * 1.61 + n) * .32;
    if (!microInFront(world, level, .04)) continue;
    vec2 center = uMicroLamp.xz + vec2(cos(orbit) * 1.05, sin(orbit) * .82) * radius;
    center += vec2(cos(orbit * .53 + n), sin(orbit * .76 - n)) * .46;
    vec2 q = microBillboard(microPlane(world, level), center);
    vec2 r = microTurn(q, orbit * .77 - n * .81);
    float wingbeat = .044 + .057 * abs(sin(t * 17.0 + n));
    float wing = microEllipse(vec2(abs(r.x) - wingbeat, r.y + .014), vec2(.063, .041), .51);
    float light = exp(-radius * .38) * (.44 + .56 * clamp(.5 + .5 * sin(orbit * 2.78 + n), 0., 1.));
    trail = max(trail, wing * light);
    glow = max(glow, microEllipse(r, vec2(.20, .161), .66) * light);
  }
  return color + (vec3(1.15, .62, .19) * trail + vec3(.50, .20, .044) * glow) * (.72 + danger * .28);
}

vec3 applyMicroFx(vec3 color, vec3 world, float day, float danger, float t) {
  microViewRay = microRayAt(world);
  vec2 p = microPlane(world, 0.);
  vec3 wetWorld = vec3(p.x, 0., p.y);
  vec3 coast = microCoast(p);
  float surface = microWaterCoverage(world, microViewRay, coast);
  float quietZone = mix(1., mix(.22, 1., smoothstep(.30, 1.35, length(p - uBobber))), uHasBobber);
  if (surface > .025) {
    float water = surface * quietZone;
    float shallow = (1. - smoothstep(.49, .96, coast.g)) * smoothstep(.52, .74, coast.b) * water;
    if (uMicro[4] > .001 && shallow > .015) {
      color = microRefract(color, wetWorld, uMicro[4], t, shallow, quietZone);
    }
    if ((uMicro[0] > .001 || uMicro[1] > .001) && shallow > .015) {
      vec2 bed = microPlane(wetWorld, -.10 - coast.g * uBottomDepth * .62);
      if (uMicro[0] > .001) color = microShards(color, bed, shallow * uMicro[0], day, t);
      if (uMicro[1] > .001) color = microSilt(color, bed, shallow * uMicro[1], day, t);
    }
    if (uMicro[2] > .001) color = microShoal(color, wetWorld, water * uMicro[2], t);
    if (uMicro[3] > .001) color = microBubbles(color, wetWorld, water * uMicro[3], t);
    if (uMicro[5] > .001) color = microPlankton(color, p, water * uMicro[5], t, danger);
    if (uMicro[6] > .001) color = microLeaves(color, p, coast, water * uMicro[6], t);
  }
  if (uMicro[7] > .001) color += (microSpray(color, world, quietZone, t) - color) * uMicro[7];
  if (uMicro[8] > .001) color += (microPollen(color, world, t, day) - color) * uMicro[8];
  if (uMicro[9] > .001) color += (microMoths(color, world, t, danger) - color) * uMicro[9];
  return color;
}
`;
