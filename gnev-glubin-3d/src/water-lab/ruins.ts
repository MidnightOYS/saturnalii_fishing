import * as T from 'three';

// A tessellated wave border and eight-petalled rosette, laid out one pebble
// at a time. Broken areas reveal the pale mortar under the design.
function mosaicTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#78796b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const unit = 8;
  for (let row = 0; row < canvas.height / unit; row++) {
    for (let col = 0; col < canvas.width / unit; col++) {
      const rx = (col + .5) * unit, ry = (row + .5) * unit;
      const x = (rx - 384) / 210, y = (ry - 256) / 210;
      const radius = Math.hypot(x, y), angle = Math.atan2(y, x);
      const edge = Math.min(rx, ry, 768 - rx, 512 - ry);
      const across = rx < 64 || rx > 704 ? ry : rx;
      const petal = .20 + .45 * Math.pow(Math.abs(Math.cos(4 * angle)), 1.3);
      const border = Math.abs(edge - 13) < 4 || Math.abs(edge - 49) < 4 ||
        (edge > 19 && edge < 43 && Math.abs(edge - 31 - 8 * Math.sin(across / 15)) < 4);
      const outline = Math.abs(radius - .77) < .035 || Math.abs(radius - petal) < .035;
      const color = new T.Color(border || outline ? '#3f5551' : radius < petal ? '#967359' :
        Math.abs(radius - .84) < .024 || radius < .11 ? '#a68a55' : '#c4b998');
      const seed = Math.sin(row * 159.23 + col * 78.21) * 43989.1;
      const noise = seed - Math.floor(seed);
      if (noise < .07 && Math.sin(col * .17 + row * .12) > .25) continue;
      color.offsetHSL(0, 0, (noise - .5) * .095);
      ctx.fillStyle = '#' + color.getHexString();
      ctx.fillRect(rx - 3.6 + (noise - .5), ry - 3.7, 7.1, 7.3);
    }
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function flutedDrum() {
  const geometry = new T.CylinderGeometry(1, 1.04, 1, 64, 1);
  const vertices = geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), z = vertices.getZ(i);
    const radius = 1 - .102 * Math.pow(.5 + .5 * Math.cos(16 * Math.atan2(z, x)), .72);
    vertices.setXYZ(i, x * radius, vertices.getY(i), z * radius);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function addLabRuins(scene: T.Scene) {
  const site = new T.Group();
  site.name = 'Submerged bath and hill gate';
  scene.add(site);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const transform = new T.Object3D(), normalMatrix = new T.Matrix3();
  const vertex = new T.Vector3(), normal = new T.Vector3(), tint = new T.Color();
  const block = new T.BoxGeometry(), drum = flutedDrum();
  const course = new T.CylinderGeometry(1, 1, 1, 24);
  const wornBlock = new T.ExtrudeGeometry(new T.Shape()
    .moveTo(-.50, -.42).lineTo(-.43, -.50).lineTo(.44, -.50).lineTo(.50, -.41)
    .lineTo(.50, .44).lineTo(.43, .50).lineTo(-.45, .50).lineTo(-.50, .42).closePath(),
    { depth: .92, bevelEnabled: true, bevelThickness: .04, bevelSize: .018, bevelSegments: 1 });
  wornBlock.rotateX(-Math.PI / 2);
  wornBlock.translate(0, -.46, 0);

  function place(shape: T.BufferGeometry, x: number, y: number, z: number, w: number, h: number, d: number,
    color: string, yaw = 0, tilt = 0) {
    transform.position.set(x, y, z);
    transform.rotation.set(0, yaw, tilt, 'YXZ');
    transform.scale.set(w, h, d);
    transform.updateMatrix();
    normalMatrix.getNormalMatrix(transform.matrix);
    const pos = shape.attributes.position, n = shape.attributes.normal, indices = shape.index;
    const count = indices ? indices.count : pos.count;
    tint.set(color);
    for (let j = 0; j < count; j++) {
      const i = indices ? indices.getX(j) : j;
      vertex.fromBufferAttribute(pos, i).applyMatrix4(transform.matrix);
      normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z);
      colors.push(tint.r, tint.g, tint.b);
    }
  }

  const quarry = ['#c5b898', '#b5af93', '#c5b99e', '#bab49b', '#bcaa8c'];
  // Five staggered, individually chipped courses descend toward the viewer.
  for (let step = 0; step < 5; step++) {
    const top = -1.26 - step * .28, base = -3.21;
    let x = -1.2 + Math.sin(step * 1.7) * .11;
    for (let i = 0; i < 6; i++) {
      const width = 1.24 + .16 * Math.sin(i * 3.31 + step * 1.73);
      if (!(step > 2 && i === 5) && !(step === 4 && i === 0))
        place(wornBlock, x + width * .5, (top + base) * .5, 2.16 + step * .57, width - .026,
          top - base, .59, quarry[(i + 3 * step) % quarry.length], .009 * Math.sin(i + step));
      x += width;
    }
  }

  place(wornBlock, 2.42, -2.26, .58, 7.40, 1.99, 2.80, '#b5a78a');
  for (const x of [-1.14, 5.97]) {
    place(wornBlock, x, -1.22, .49, .32, .20, 2.59, '#c6b898');
    place(wornBlock, x, -1.87, 3.43, .54, .67, 1.15, '#b0a68d');
  }
  const mosaic = new T.Mesh(new T.PlaneGeometry(5.72, 2.43),
    new T.MeshStandardMaterial({ map: mosaicTexture(), roughness: .92 }));
  mosaic.name = 'Pebble mosaic, eight petals and wave border';
  mosaic.rotation.x = -Math.PI / 2;
  mosaic.position.set(2.43, -1.258, .59);
  site.add(mosaic);

  // Broken fluted shafts beside the landing stay below the navigable surface.
  place(course, 5.72, -1.15, -.30, .51, .22, .51, '#c7bca2');
  place(drum, 5.72, -.86, -.30, .35, .42, .35, '#c7beab', .1, .045);
  place(drum, 6.67, -2.30, .92, .37, 1.42, .37, '#b6af95', -.47, 1.57);
  place(drum, -1.84, -1.92, .85, .33, 1.13, .33, '#bcb69e', .39, 1.47);

  const gateStart = positions.length / 3;
  // A small stone gate on the limestone headland. Foundations reach the
  // irregular island surface under both feet.
  const cx = -11.55, cz = -9.5, pitch = 3.36;
  place(wornBlock, cx, 2.7, cz, 4.50, 1.54, 1.64, '#968f79');
  for (const side of [-1, 1]) {
    const x = cx + side * 1.26;
    place(wornBlock, x, 3.50, cz, 1.02, .35, 1.13, '#c7baa1');
    place(wornBlock, x, 3.76, cz, .85, .18, .95, '#aaa187');
    for (let i = 0; i < 4; i++)
      place(drum, x, 4.10 + i * .53, cz, .345 - i * .006, .525, .345 - i * .006, quarry[i], .15);
    place(course, x, 6.04, cz, .41, .18, .41, '#b7ab8e');
    place(block, x, 6.19, cz, .90, .15, .92, '#c7b99a');
  }
  place(wornBlock, cx, 6.46, cz, 3.98, .42, .91, '#beaf8f');
  place(block, cx, 6.72, cz, 4.19, .12, 1.07, '#c4b9a0');
  const pediment = new T.ExtrudeGeometry(new T.Shape()
    .moveTo(-pitch / 2, 0).lineTo(pitch / 2, 0).lineTo(.01, .66).closePath(),
    { depth: .61, bevelEnabled: false });
  place(pediment, cx, 6.80, cz - .305, 1, 1, 1, '#b6a88d');
  // A shallow inset accent gives the triangle a readable shadow at this scale.
  place(pediment, cx, 6.84, cz + .312, .79, .68, .022, '#958868');
  for (const geometry of [block, drum, course, pediment, wornBlock]) geometry.dispose();

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  const masonry = new T.Mesh(geometry, new T.MeshStandardMaterial({ vertexColors: true, roughness: .92 }));
  masonry.name = 'Limestone courses, sunken shafts and headland gate';
  site.add(masonry);
  return (visible: boolean) => {
    mosaic.visible = visible;
    geometry.setDrawRange(visible ? 0 : gateStart, Infinity);
  };
}
