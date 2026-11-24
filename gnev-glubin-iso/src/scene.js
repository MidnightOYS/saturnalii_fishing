import sheet from '../assets/greek-shore.png';
import { width, height, project, unproject, dock, tile, distance } from './maps.js';
import { castRange, schoolRadius } from './expedition.js';

const atlas = new Image();
atlas.src = sheet;
const sprites = {
  tree: [0, 0, .246, .494, .51, .96],
  shrine: [.253, 0, .243, .5, .51, .97],
  cypress: [.505, 0, .238, .498, .52, .98],
  face: [.751, .022, .249, .473, .52, .91],
  rock: [0, .54, .245, .422, .49, .9],
  vase: [.252, .51, .246, .49, .49, .98],
  lamp: [.513, .502, .224, .498, .47, .98],
  boat: [.75, .511, .25, .484, .50, .76]
};

function canvasLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function polygon(ctx, points) {
  ctx.beginPath();
  for (const [i, [x, y]] of points.entries()) i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  ctx.closePath();
}

function shape(ctx, points, fill, stroke, lineWidth = 1) {
  polygon(ctx, points);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function ellipse(ctx, x, y, rx, ry, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function line(ctx, ax, ay, bx, by, color, size = 1) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();
}

function randomizer() {
  let seed = 27134;
  return () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
}

function resizeBank(bank, factor, yOffset = 0) {
  return bank.map(([x, y]) => [600 + (x - 600) * factor, 361 + (y - 361) * factor + yOffset]);
}

function coast(map) {
  const canvas = canvasLayer();
  const ctx = canvas.getContext('2d');
  const random = randomizer();
  ctx.fillStyle = map.land;
  ctx.fillRect(0, 0, width, height);
  shape(ctx, resizeBank(map.bank, 1.18, -25), '#343a39', '#535650', 3);
  shape(ctx, resizeBank(map.bank, 1.12, -12), '#464a42', '#222e30', 7);
  shape(ctx, resizeBank(map.bank, 1.067, -5), '#66695b', '#28363a', 4);
  for (let i = 0; i < 2700; i++) {
    const x = random() * width, y = random() * height;
    line(ctx, x, y, x + random() * 16 - 3, y - random() * 5, i % 3 === 0 ? '#b4a28224' : '#10182334', .7 + random() * 1.2);
  }
  map.bank.forEach(([ax, ay], i) => {
    const [bx, by] = map.bank[(i + 1) % map.bank.length];
    const top = ay < 346;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 19);
    for (let k = 0; k < n; k++) {
      const t = (k + .45) / n;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const w = 12 + random() * 12, h = (top ? 14 : 8) + random() * 18;
      const direction = top ? -1 : 1;
      const left = [x - w, y + h * direction * .72], tip = [x + w * .16, y + h * direction];
      const right = [x + w * .79, y + h * direction * .58];
      shape(ctx, [[x - w * .75,y+4], left, tip, right, [x+w,y+5],[x,y+9]], '#303b3c', '#242d31', 1.6);
      shape(ctx, [[x-w*.75,y+4], left, tip, [x+2,y+h*direction*.26]], top ? '#797968' : '#636359');
      shape(ctx, [tip, right, [x+w,y+5],[x+2,y+h*direction*.26]], '#4e514a');
    }
  });
  const water = ctx.createLinearGradient(0, 150, 140, 610);
  map.water.forEach((color, index) => water.addColorStop(index / 2, color));
  shape(ctx, map.bank, water, '#17272c', 6);
  ctx.save();
  polygon(ctx, map.bank);
  ctx.clip();
  polygon(ctx, map.bank);
  ctx.lineWidth = 29;
  ctx.strokeStyle = map.shallow + '58';
  ctx.stroke();
  polygon(ctx, resizeBank(map.bank, .96, 2));
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#c1be982c';
  ctx.stroke();
  for (let i = 0; i < 1850; i++) {
    const x = random() * width, y = 130 + random() * height;
    line(ctx, x, y, x + 2 + random() * 16, y - 1, i % 5 ? '#adc7ac15' : '#091d2f42');
  }
  ctx.restore();
  return canvas;
}

function paintSprite(ctx, id, x, y, size, mirror = 1, reflection = false) {
  if (!atlas.complete || !atlas.naturalWidth) return;
  const [sx, sy, w, h, px, py] = sprites[id];
  const sourceWidth = w * atlas.naturalWidth, sourceHeight = h * atlas.naturalHeight;
  const tall = size * sourceHeight / sourceWidth;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(mirror, reflection ? -.44 : 1);
  if (reflection) ctx.globalAlpha *= .21;
  ctx.drawImage(atlas, sx * atlas.naturalWidth, sy * atlas.naturalHeight, sourceWidth, sourceHeight,
    -size * px, -tall * py, size, tall);
  ctx.restore();
}

function pier(ctx, stone) {
  // Dock draws over the water. Its tip is the return marker and spawn.
  shape(ctx, [[530,671],[561,584],[634,562],[688,652],[670,680],[539,686]], '#111d23ad');
  shape(ctx, [[536,658],[568,584],[633,562],[675,648],[667,674],[538,680]], stone ? '#333736' : '#261e22', '#141d23', 3);
  const fill = stone ? ['#8a8170','#776f64','#948775'] : ['#897054','#a1845e','#705f4d'];
  for (let i = 0; i < 13; i++) {
    const ax = 571 - i * 2.9, ay = 580 + i * 6.3, bx = 632 + i * 3.8, by = 562 + i * 7.2;
    shape(ctx, [[ax,ay],[bx,by],[bx+2,by+6],[ax-2.6,ay+6.3]], fill[i % 3], '#493b32', 1.4);
    line(ctx, ax + 6, ay + 2, bx - 7, by + 3, '#ddc59b60', 1);
    if (stone) line(ctx,(ax+bx)/2,(ay+by)/2,(ax+bx)/2+1,(ay+by)/2+6,'#4d4943',1);
  }
  for (const [x,y] of [[571,581],[633,563],[550,642],[665,634]]) {
    line(ctx, x, y - 13, x, y + 13, '#27232a', 8);
    line(ctx, x - 1, y - 11, x - 1, y + 5, '#ae8c69', 3);
  }
}

function label(ctx, text, x, y, color) {
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 19;
  ctx.fillStyle = '#142327e8';
  ctx.fillRect(x - w/2, y - 14, w, 21);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function ring(ctx, point, radius, color, weight) {
  ellipse(ctx, point.x, point.y, radius * tile.x * Math.SQRT2, radius * tile.y * Math.SQRT2, null, color, weight);
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.coasts = new Map();
    const random = randomizer();
    this.ripples = Array.from({ length: 200 }, () => [
      90 + random() * 1015, 147 + random() * 470, 3 + random() * 24
    ]);
  }

  resize() {
    const ratio = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * ratio);
    const h = Math.round(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.scale = Math.min(w / width, h / height);
    this.offsetX = (w - width * this.scale) / 2;
    this.offsetY = (h - height * this.scale) / 2;
  }

  point(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return unproject({
      x: ((event.clientX - bounds.left) * this.canvas.width / bounds.width - this.offsetX) / this.scale,
      y: ((event.clientY - bounds.top) * this.canvas.height / bounds.height - this.offsetY) / this.scale
    });
  }

  draw(game, time, pointer, landing) {
    const ctx = this.ctx;
    this.resize();
    if (!this.scale) return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = '#11191f';
    ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    ctx.setTransform(this.scale,0,0,this.scale,this.offsetX,this.offsetY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    const map = game.map;
    if (!this.coasts.has(map)) this.coasts.set(map, coast(map));
    ctx.drawImage(this.coasts.get(map), 0, 0);
    ctx.save();
    polygon(ctx, map.bank);
    ctx.clip();
    for (const [i,[x,y,w]] of this.ripples.entries()) {
      const phase = time * .8 + i * 1.6;
      ctx.globalAlpha = .18 + .24 * (Math.sin(phase) + 1) / 2;
      const drift = Math.cos(phase * .7) * 11;
      line(ctx,x + drift,y,x + drift + w,y-.8,i % 3 ? '#a7c5b2' : '#101f36');
    }
    ctx.restore();
    for (const [x,y,radius] of map.islands) {
      ellipse(ctx,x,y+4,radius*32,radius*15,'#142832a8','#93a6a35e',2);
      ellipse(ctx,x,y-1,radius*28,radius*12,'#4c5553','#202b31',3);
      line(ctx,x-radius*25,y+4,x-radius*13,y+10,'#a49c7a',1.5);
    }
    const p = project(game.position);
    const r = game.run;
    const bob = Math.sin(time * 3.4) * (game.movement ? 1.9 : 1.1);

    if (r?.phase === 'ready' && pointer) {
      const shot = game.inspect(pointer);
      ctx.setLineDash([4, 5]);
      ring(ctx,p,castRange,'#dec79b42',1.2);
      ctx.setLineDash([]);
      const target = project(pointer);
      const color = shot.range <= castRange && shot.range >= .5 && shot.clear ? (shot.school ? '#e3be7f' : '#a9d3c6') : '#b56756';
      line(ctx,p.x,p.y,target.x,target.y,color + '7b',1.2);
      ring(ctx,target,.33,color,1.7);
    }
    if (r) for (const school of game.schools) {
      if (school.availableAt > r.time) continue;
      const q = project(school);
      ring(ctx,q,schoolRadius,'#c6dcd75e',1.4);
      for (let i = 0; i < 3; i++) {
        const cycle = (time * .65 + i / 3 + school.x * .3 % 1 + 1) % 1;
        ring(ctx,q,.28 + cycle * .95,'#c4ded4' + Math.floor(105 * (1-cycle)).toString(16).padStart(2,'0'),1.6);
      }
      for (let i = 0; i < 4; i++) {
        const angle = time * .75 + i * 1.68;
        ellipse(ctx,q.x+Math.cos(angle)*22,q.y+Math.sin(angle)*9,3,1.15,'#7faea3');
      }
    }
    const items = map.art.map(([id,x,y,size]) => ({ y, paint: () => {
      ellipse(ctx,x,y+1,size*.25,size*.063,'#151f256a');
      paintSprite(ctx,id,x,y,size);
    } }));
    items.push({ y: 572, paint: () => pier(ctx,map.number === 'II') });
    items.push({ y:p.y, paint: () => {
      if (game.movement > .03 && r) {
        for (let i=1; i<5; i++) ellipse(ctx,p.x-game.travel.x*i*5,p.y-game.travel.y*i*5,22+i*2,3+i,'#9cbbac12');
      }
      ellipse(ctx,p.x,p.y,35,9,'#19292f83');
      paintSprite(ctx,'boat',p.x,p.y+8,84,game.facing,true);
      paintSprite(ctx,'boat',p.x,p.y+bob,84,game.facing);
      if (!atlas.naturalWidth) ellipse(ctx,p.x,p.y,32,11,'#a98463','#292322',3);
    } });
    items.sort((a,b) => a.y-b.y).forEach(item => item.paint());
    const wrath = r?.wrath ?? 0;
    if (wrath > 0) {
      ctx.fillStyle = 'rgba(21,12,39,' + (wrath / 215) + ')';
      ctx.fillRect(0,0,width,height);
      if (wrath > 32) {
        const gloom = ctx.createRadialGradient(600,390,165,600,390,520);
        gloom.addColorStop(0,'transparent');
        gloom.addColorStop(1,'rgba(76,26,48,' + ((wrath - 32) / 112) + ')');
        ctx.fillStyle = gloom;
        ctx.fillRect(0,0,width,height);
      }
    }
    const vignette = ctx.createRadialGradient(600,375,200,600,375,700);
    vignette.addColorStop(0,'transparent');
    vignette.addColorStop(1,'#0b151ed5');
    ctx.fillStyle = vignette;
    ctx.fillRect(0,0,width,height);
    if (r?.attack) {
      const x = p.x + r.attack.side * 75;
      ellipse(ctx,x,p.y-8,44,16,'#1b1321c7','#c487745e',2);
      for (let i=0; i<3; i++) {
        line(ctx,x+i*11-10,p.y-16,x+i*9-11+Math.sin(time*6+i)*14,p.y-46-i*5,'#4a2c48',6);
      }
      label(ctx,'F  ·  Отпугнуть',x,p.y-56,'#ffd5ac');
    }
    if (r?.cast && game.castPoint) this.lineAndFloat(game,p,time);
    const q = project(dock);
    if (r && r.phase === 'ready') {
      ring(ctx,q,.53,'#d2b585a5',1.4);
      label(ctx,'E  ·  Причал',q.x,q.y+51,'#e4c48e');
    }
    if (landing) label(ctx,map.name,600,115,'#e8cfa3');
    ctx.restore();
  }

  lineAndFloat(game, p, time) {
    const ctx = this.ctx, r = game.run;
    const target = project(game.castPoint);
    const flight = r.phase === 'cast' ? Math.min(1,r.age/game.balance.aim.flight) : 1;
    const fight = ['struggle','reel'].includes(r.phase);
    const t = flight < 1 ? flight : fight ? Math.min(1,r.distance / Math.max(4,distance(game.position,game.castPoint))) : 1;
    const x = p.x + (target.x-p.x)*t + (fight ? r.fishX*16 : 0);
    const y = p.y + (target.y-p.y)*t - Math.sin(Math.PI*flight)*103 + Math.sin(time*(r.phase==='hook' ? 16 : 4))*2;
    const rodX = p.x+game.facing*19+r.rod*14, rodY = p.y-29;
    ctx.beginPath();
    ctx.moveTo(rodX,rodY);
    ctx.quadraticCurveTo((rodX+x)/2,(rodY+y)/2+9,x,y);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = r.tension > 66 ? '#e78776' : '#dac8a9';
    ctx.stroke();
    ellipse(ctx,x,y,4,5,'#e4ab72','#492c33',1.3);
    line(ctx,x,y-7,x,y-1,'#f1deb4',2);
    if (flight === 1) {
      const q = .35 + (Math.sin(time * 7) + 1) * .22;
      ring(ctx,{ x, y },q,r.phase === 'hook' ? '#ffd393' : '#9bbdc77e',1.7);
    }
  }
}
