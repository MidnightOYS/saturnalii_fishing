import './style.css';
import { fish } from '../../packages/fishing/game.js';
import { maps } from './maps.js';
import { Expedition } from './expedition.js';
import { Scene } from './scene.js';

const $ = id => document.getElementById(id);
const saveKey = 'gnev-glubin.isometric.v1';
function readSave() {
  try {
    const data = JSON.parse(localStorage.getItem(saveKey));
    if (!data || typeof data !== 'object') return {};
    const sales = Object.fromEntries(Object.keys(fish).flatMap(id => {
      const count = data.sales?.[id];
      return Number.isSafeInteger(count) && count > 0 ? [[id,count]] : [];
    }));
    return {
      gold: Number.isSafeInteger(data.gold) && data.gold >= 0 ? data.gold : 0,
      xp: Number.isSafeInteger(data.xp) && data.xp >= 0 ? data.xp : 0,
      offerings: Number.isSafeInteger(data.offerings) && data.offerings >= 0 ? data.offerings : 1,
      boat: data.boat === true, line: data.line === true, quotaMet: data.quotaMet === true,
      visitedTemple: data.visitedTemple === true, sales
    };
  } catch { return {}; }
}

const game = new Expedition(readSave());
const scene = new Scene($('scene'));
const keys = new Set();
let pointer = null;
let packSignature = '';
let saved = JSON.stringify(game.meta);
let tabActive = !document.hidden;
const movingKeys = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight'];
const controls = new Set([...movingKeys, 'Space','KeyE','KeyO','KeyF','KeyR','Escape']);
const phases = {
  ready: ['На воде','WASD / стрелки — лодка · ЛКМ — заброс. Ищи кольца на воде.'],
  cast: ['Заброс','Поплавок летит к выбранной точке.'],
  wait: ['Ожидание','Следи за поплавком.'],
  hook: ['Клюёт!', 'Нажми пробел, когда риска войдёт в зелёную зону.'],
  struggle: ['Рыба рвётся', ''],
  reel: ['Рыба устала', 'Держи пробел, чтобы подмотать леску.'],
  surge: ['Гнев Посейдона', 'Вода накрывает лодку.']
};

function show(id, visible) { $(id).hidden = !visible; }
function write(id, text) { if ($(id).textContent !== text) $(id).textContent = text; }
function button(text, action, disabled = false, style = '') {
  const node = document.createElement('button');
  node.textContent = text;
  node.dataset.action = action;
  node.disabled = disabled;
  node.className = style;
  return node;
}

function renderPort() {
  const destinations = Object.entries(maps).map(([id, map]) => {
    const locked = id === 'temple' && !game.meta.boat;
    const node = button('',id,locked,'destination' + (id === 'pond' ? ' primary' : ''));
    const number = document.createElement('span');
    number.className = 'num';
    number.textContent = map.number;
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = map.name;
    const detail = document.createElement('small');
    detail.textContent = locked ? 'Нужен ремонт лодки · ' + game.balance.economy.boat + ' др.' : map.description;
    copy.append(name,detail);
    node.append(number,copy);
    return node;
  });
  $('destinations').replaceChildren(...destinations);
  const amount = Object.entries(game.meta.sales).reduce((sum,[id,count]) => sum + game.balance[id].value * count,0);
  const stock = [button(amount ? 'Продать улов · +' + amount + ' др.' : 'Продать улов','sell',!amount)];
  if (game.meta.quotaMet) for (const [id,label] of [['boat','Ремонт лодки'],['line','Крепкая леска'],['offering','Подношение']]) {
    if (id !== 'offering' && game.meta[id]) continue;
    const price = game.balance.economy[id];
    stock.push(button(label + ' · ' + price + ' др.',id,game.meta.gold < price));
  }
  $('store').replaceChildren(...stock);
}

function syncHUD() {
  const r = game.run, result = game.result;
  $('game').classList.toggle('play', Boolean(r));
  show('port',!r && !result);
  show('result',Boolean(result));
  show('wrath',Boolean(r));
  show('health',Boolean(r));
  show('hud',Boolean(r));
  const packing = r?.phase === 'pack';
  show('status',Boolean(r && !packing));
  show('pack',packing);
  write('place',r ? game.map.name : result ? 'Итог вылазки' : 'Причал');
  write('gold',game.meta.gold + ' др.');
  if (result) {
    write('result-heading',result.success ? 'Улов доставлен' : result.reason === 'quota' ? 'Квота не набрана' : 'Вылазка сорвалась');
    write('result-body',result.success
      ? 'В трюме ' + result.count + ' рыб на ' + result.value + ' драхм. Улов готов к продаже в лавке.'
      : result.reason === 'quota'
        ? 'Ты вернулся к причалу. Для сдачи улова нужно ' + game.balance.economy.quota + ' очка. Набрано ' + result.score + '.'
        : 'Глубины забрали добычу этой вылазки. Рыб потеряно: ' + (result.count + Number(result.lostPending)) + '.');
  }
  if (!r) return;
  write('health','Здоровье ' + r.health + '/' + game.balance.wrath.health);
  write('stage',['','Тихая вода','Знамение','Ярость'][game.stage]);
  write('wrath-value',Math.floor(r.wrath) + '%');
  $('wrath-bar').value = r.wrath;
  const count = r.cargo.reduce((sum,item) => sum + item.count,0);
  write('quota','Трюм · ' + count + ' рыб   /   Квота ' + game.score + ' из ' + game.balance.economy.quota);
  write('notice',r.noticeFor > 0 ? r.notice : game.nearDock ? 'Ты у причала' : 'Причал внизу карты');
  $('return').disabled = !game.nearDock || r.phase === 'surge';
  $('offering').disabled = !game.meta.offerings || r.phase === 'surge';
  $('offering').textContent = 'Подношение · O (' + game.meta.offerings + ')';
  show('repel',Boolean(r.attack));
  if (packing) {
    renderPack(r);
    return;
  }
  packSignature = '';
  const [title, hint] = phases[r.phase];
  write('phase',title);
  write('instruction',r.phase === 'struggle'
    ? r.direction === 'left' ? 'Рывок влево. Держи D / →.' : 'Рывок вправо. Держи A / ←.'
    : hint);
  show('bite',r.phase === 'hook');
  $('marker').style.left = (game.marker * 100) + '%';
  show('fight',r.phase === 'struggle' || r.phase === 'reel');
  $('tension').value = r.tension;
  write('line-value',Math.round(r.tension) + '%  ·  ' + r.distance.toFixed(1) + ' м');
}

function renderPack(r) {
  write('pack-notice',r.noticeFor > 0 ? r.notice : '');
  const { pending,cargo,grid } = r;
  const signature = JSON.stringify([pending,cargo,game.visit]);
  if (signature === packSignature) return;
  packSignature = signature;
  const [w,h] = game.dimensions(pending);
  write('caught',fish[pending.id].name + ' · ' + w + '×' + h + ' клетки. Выбери левую верхнюю ячейку.');
  document.querySelector('[data-action="stack"]').disabled = !cargo.some(item => item.id === pending.id && item.count < game.balance.economy.stackLimit);
  const cells = [];
  $('grid').style.gridTemplateColumns = 'repeat(' + grid.columns + ',1fr)';
  for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.columns; x++) {
    const cell = button('','pack',false,'cell');
    cell.setAttribute('aria-label','Положить улов в ячейку ' + (x + 1) + ', ' + (y + 1));
    cell.style.gridArea = (y + 1) + ' / ' + (x + 1);
    cell.dataset.x = x;
    cell.dataset.y = y;
    cells.push(cell);
  }
  for (const item of cargo) {
    const [cw,ch] = game.dimensions(item);
    const slot = button(fish[item.id].name + (item.count > 1 ? ' ×' + item.count : ''),'discard',false,'fish');
    slot.title = 'Выпустить из трюма';
    slot.style.gridArea = (item.y + 1) + ' / ' + (item.x + 1) + ' / span ' + ch + ' / span ' + cw;
    slot.style.setProperty('--fish',fish[item.id].color);
    slot.dataset.key = item.key;
    cells.push(slot);
  }
  $('grid').replaceChildren(...cells);
}

function act(action, data = {}) {
  if (action === 'pond' || action === 'temple') {
    if (game.start(action)) clearInput();
  } else if (action === 'continue' && game.result) {
    game.result = null;
    renderPort();
  } else if (!game.run && !game.result) {
    if (action === 'sell') game.sell();
    else game.buy(action);
    renderPort();
  } else if (game.run) {
    if (action === 'return') game.returnToPier();
    else if (action === 'repel') game.repel();
    else if (action === 'offering') game.offering();
    else if (action === 'cancel') game.cancel();
    else if (game.run.phase === 'pack') {
      if (action === 'rotate') game.rotate();
      else if (action === 'stack') game.stack();
      else if (action === 'release') game.release(undefined);
      else if (action === 'discard') game.release(Number(data.key));
      else if (action === 'pack' && !game.pack(Number(data.x),Number(data.y))) game.tell('В этой ячейке рыба не помещается.');
    }
  }
  save();
  syncHUD();
}

function save() {
  const data = JSON.stringify(game.meta);
  if (data === saved) return;
  saved = data;
  try { localStorage.setItem(saveKey,data); } catch { /* The session remains playable. */ }
}

$('game').addEventListener('click',event => {
  const source = event.target.closest('button[data-action]');
  if (source) act(source.dataset.action,source.dataset);
});
$('scene').addEventListener('pointermove',event => { if (game.run) pointer = scene.point(event); });
$('scene').addEventListener('pointerleave',() => { pointer = null; });
$('scene').addEventListener('pointerdown',event => {
  if (event.button !== 0 || !game.run) return;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  pointer = scene.point(event);
  game.throwAt(pointer);
});
function clearInput() { keys.clear(); game.inputs.clear(); pointer = null; }
window.addEventListener('keydown',event => {
  if (!game.run || !controls.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'Space' && event.target instanceof HTMLButtonElement && game.run.phase === 'pack') return;
  event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'Space') {
    if (game.run.phase === 'hook') {
      game.primary();
      keys.delete('Space');
    }
  } else {
    const action = { KeyE:'return',KeyF:'repel',KeyO:'offering',KeyR:'rotate',Escape:'cancel' }[event.code];
    if (action) act(action);
  }
});
window.addEventListener('keyup',event => { keys.delete(event.code); });
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',() => { tabActive = !document.hidden; clearInput(); });

function updateInput() {
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');
  game.travel = { x: Number(right) - Number(left), y: Number(down) - Number(up) };
  game.inputs.clear();
  if (left) game.inputs.add('left');
  if (right) game.inputs.add('right');
  if (keys.has('Space')) game.inputs.add('reel');
}

$('band').style.left = (game.balance.bite.bandStart * 100) + '%';
$('band').style.width = ((game.balance.bite.bandEnd - game.balance.bite.bandStart) * 100) + '%';
renderPort();
syncHUD();
let previous = performance.now();
function frame(now) {
  if (tabActive) {
    const dt = Math.min(.05,(now-previous)/1000);
    updateInput();
    if (game.run) game.step(dt);
    if (game.events.length) {
      game.events.length = 0;
      save();
    }
    scene.draw(game,now/1000,pointer,!game.run && !game.result);
    syncHUD();
  }
  previous = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
