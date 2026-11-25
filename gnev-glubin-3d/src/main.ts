import './style.css';
import './visual-inspector.css';
import { counter, fish, zones } from './rules/game.js';
import { Expedition } from './expedition';
import { disposeLocation, loadLocation, type LoadedLocation } from './location-assets';
import type { LocationSlot } from './location-navigation';
import { createScene } from './scene';
import { makeVisualInspector } from './visual-inspector';
import { defaultCollection, readCollection } from './water-lab/collection-settings';
import { makeLabUI } from './water-lab/collection-ui';

const saveKey = 'gnev-glubin-3d.progress.v1';
const waterSaveKey = 'gnev-glubin-3d.water.v1';
type Meta = InstanceType<typeof Expedition>['meta'];
type FishId = keyof typeof fish;
type Input = 'left' | 'right' | 'reel';
type Menu = 'map' | 'shop' | 'result' | 'exit';
const locationInfo = {
  pond: { name: 'Лунный водосбор', description: 'Тихая вода у каменной цистерны. Первый косяк у пристани.' },
  temple: { name: 'Гавань затонувшего лика', description: 'Бронзовый лик под водой. Гнев растёт быстрее, редкий улов попадается чаще.' },
} as const;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

function readProgress(): Partial<Meta> {
  try {
    const saved = JSON.parse(localStorage.getItem(saveKey) ?? '{}');
    const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;
    const sales = Object.fromEntries(Object.keys(fish)
      .filter(id => count(saved?.sales?.[id]) > 0)
      .map(id => [id, count(saved.sales[id])]));
    return {
      gold: count(saved?.gold), xp: count(saved?.xp), sales,
      boat: saved?.boat === true, line: saved?.line === true,
      quotaMet: saved?.quotaMet === true, visitedTemple: saved?.visitedTemple === true,
      ...(saved?.offerings === undefined ? {} : { offerings: count(saved.offerings) })
    };
  } catch {
    return {};
  }
}

const game = new Expedition(readProgress());
const sceneHost = byId('scene');
let scene: ReturnType<typeof createScene> | undefined;
try {
  scene = createScene(sceneHost, game, [byId('dock-shop'), byId('dock-boat')]);
} catch (error) {
  byId('render-error').hidden = false;
  console.warn('WebGL scene initialization failed', error);
}

const menu = byId<HTMLDialogElement>('menu');
const waterInspector = byId('game-water-inspector');
const waterSettingsToggle = byId<HTMLButtonElement>('water-settings-toggle');
if (scene) {
  makeVisualInspector(waterInspector, tuning => {
    scene?.setVisualTuning(tuning);
    byId('game').style.setProperty('--expedition-vignette', String(tuning.vignette));
  });
  let profile = defaultCollection(true);
  try {
    const saved = localStorage.getItem(waterSaveKey);
    if (saved) profile = readCollection(JSON.parse(saved), profile);
  } catch {
    // Use the collection defaults if settings cannot be read.
  }
  scene.selectWater(profile.mode, profile.modes[profile.mode]);
  makeLabUI((mode, settings, snapshot) => {
    scene?.selectWater(mode, settings);
    try {
      localStorage.setItem(waterSaveKey, JSON.stringify(snapshot));
    } catch {
      // Settings still apply to the current session.
    }
  }, undefined, { root: byId('game-water-controls'), initial: profile, game: true });
} else {
  waterSettingsToggle.disabled = true;
}
const menuContent = byId('menu-content');
const water = byId('fishing');
const gameRoot = byId('game');
const gameHeader = byId('game-header');
const zoneIntro = byId('zone-intro');
const hold = byId('hold');
const cover = document.createElement('div');
cover.className = 'hold-cover';
cover.hidden = true;
hold.before(cover);

const hud = {
  stage: byId('stage'), wrath: byId<HTMLProgressElement>('wrath'), wrathNumber: byId('wrath-number'),
  quota: byId('quota'), health: byId('health'), offerings: byId('offerings'), notice: byId('notice'),
  phase: byId('phase'), timing: byId('timing'), band: byId('timing-band'), marker: byId('marker'),
  fight: byId('fight'), tension: byId<HTMLProgressElement>('tension'), tensionNumber: byId('tension-number'),
  distance: byId<HTMLProgressElement>('distance'), distanceNumber: byId('distance-number'), attack: byId('attack'),
  bow: byId<HTMLButtonElement>('bow-button'), bowMeter: byId('bow-meter'), draw: byId<HTMLProgressElement>('bow-draw'),
  castMeter: byId('cast-meter'), castCharge: byId<HTMLProgressElement>('cast-charge'), castDistance: byId('cast-distance'),
  offeringButton: water.querySelector<HTMLButtonElement>('[data-action="offering"]')!,
  holdButton: water.querySelector<HTMLButtonElement>('[data-action="hold"]')!,
  returnButton: water.querySelector<HTMLButtonElement>('[data-action="return"]')!
};

const keys = new Map<string, Input>();
const inputKeys: Partial<Record<string, Input>> = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'reel'
};
const helmKeys: Partial<Record<string, string>> = {
  KeyW: 'north', KeyS: 'south', KeyA: 'west', KeyD: 'east'
};
let drawPointer: number | null = null;
let pointer: { clientX: number; clientY: number } | null = null;
const stages = ['Тихая вода', 'Знамение', 'Ярость'];
let currentMenu: Menu | null = null;
let selectedZone: LocationSlot = 'pond';
let loadingLocation: AbortController | null = null;
let mapNotice = '';
let shopNotice = '';
let inspectingHold = false;
let lastPhaseLabel = '';
let arrivalUntil = 0;
let hasCast = false;
let focusAfterDialog: HTMLElement | null = null;

function save() {
  try {
    localStorage.setItem(saveKey, JSON.stringify(game.meta));
  } catch {
    // The current session still works when storage is blocked.
  }
}

function updateDock() {
  byId('gold').textContent = String(game.meta.gold);
  byId('xp').textContent = String(game.meta.xp);
  byId('dock-goal').textContent = game.meta.boat
    ? 'Лодка починена. Теперь можно выйти в Гавань затонувшего лика.'
    : 'Выполни квоту в Лунном водосборе. Продай улов и почини лодку, чтобы открыть Гавань затонувшего лика.';
}

function showDock() {
  byId('dock').hidden = false;
  water.hidden = true;
  delete gameRoot.dataset.expedition;
  updateDock();
}

function clearInputs() {
  keys.clear();
  game.inputs.clear();
  game.helm.clear();
  game.abortDraw();
  drawPointer = null;
  pointer = null;
}

function toggleWaterInspector() {
  waterInspector.hidden = !waterInspector.hidden;
  waterSettingsToggle.setAttribute('aria-expanded', String(!waterInspector.hidden));
  if (waterInspector.hidden) waterSettingsToggle.focus();
  else {
    clearInputs();
    waterInspector.querySelector('button')?.focus();
  }
}

function toggleBow() {
  game.toggleBow();
  clearInputs();
  if (game.aiming) inspectingHold = false;
  renderHold(!game.aiming);
}

function showMenu(name: Menu) {
  clearInputs();
  currentMenu = name;
  if (!menu.open) {
    focusAfterDialog = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  renderMenu();
  if (!menu.open) menu.showModal();
}

function closeMenu() {
  const fromResult = currentMenu === 'result';
  if (fromResult) game.result = null;
  loadingLocation?.abort();
  loadingLocation = null;
  currentMenu = null;
  menu.close();
  if (fromResult) byId('dock-boat').focus();
  else if (focusAfterDialog?.isConnected && !focusAfterDialog.closest('[hidden]')) focusAfterDialog.focus();
  focusAfterDialog = null;
}

function price(id: FishId) {
  return game.balance[id].value;
}

function heading(title: string, context: string, close = true) {
  return `<header class="panel-head"><div><span class="eyebrow">${context}</span><h2 id="menu-title">${title}</h2></div>
    ${close ? '<button data-action="close-menu" aria-label="Закрыть">×</button>' : ''}</header>`;
}

function renderMenu() {
  const previous = menuContent.contains(document.activeElement) && document.activeElement instanceof HTMLButtonElement
    ? document.activeElement.dataset : null;

  if (currentMenu === 'map') {
    const locked = selectedZone === 'temple' && !game.meta.boat;
    const cards = zones.map(zone => {
      const id = zone.id as LocationSlot;
      const info = locationInfo[id];
      const isLocked = id === 'temple' && !game.meta.boat;
      return `<button class="location" data-action="zone" data-id="${id}" aria-pressed="${selectedZone === id}" ${loadingLocation ? 'disabled' : ''}>
        <span class="eyebrow">${zone.number}</span><strong>${info.name}</strong>
        <small>${info.description}</small>${isLocked ? '<p>Требуется ремонт лодки</p>' : ''}</button>`;
    }).join('');
    menuContent.innerHTML = `${heading('Выбор места', 'Лодка')}<div class="locations">${cards}</div>
      <div class="button-row"><span>Подношения · ${game.meta.offerings}</span>
      <button class="primary" data-action="sail" ${locked || loadingLocation || !scene ? 'disabled' : ''}>Выйти на воду</button></div>
      <p class="map-notice" role="status">${loadingLocation ? 'Загружаем локацию…' : mapNotice}</p>`;
  } else if (currentMenu === 'shop') {
    const catchForSale = Object.entries(game.meta.sales) as [FishId, number][];
    const value = catchForSale.reduce((sum, [id, amount]) => sum + price(id) * amount, 0);
    const catchNames = catchForSale.map(([id, count]) => `${fish[id].name} × ${count}`).join(' · ');
    const upgrades = [
      { id: 'boat', name: 'Ремонт лодки', effect: 'Открывает Гавань затонувшего лика.' },
      { id: 'line', name: 'Крепкая леска', effect: 'Натяжение нарастает медленнее.' },
      { id: 'offering', name: 'Подношение', effect: 'Снижает гнев до стадии Ярости.' }
    ] as const;
    menuContent.innerHTML = `${heading('Лавка', `Причал · ${game.meta.gold} др.`)}
      <p class="panel-text">${game.meta.quotaMet ? 'Продай доставленный улов и выбери улучшение.' : 'Улучшения станут доступны после первой выполненной квоты.'}</p>
      <div class="menu-row"><div><strong>Улов на продажу</strong><small>${catchNames || 'Пока пусто'}</small></div>
      <button class="primary" data-action="sell" ${catchForSale.length ? '' : 'disabled'}>Продать · ${value} др.</button></div>
      ${upgrades.map(({ id, name, effect }) => {
        const cost = game.balance.economy[id];
        const bought = id !== 'offering' && game.meta[id];
        return `<div class="menu-row"><div><strong>${name}</strong><small>${effect}</small></div>
          <button data-action="buy" data-id="${id}" aria-label="${bought ? name + ' выполнен' : name + ' · ' + cost + ' др.'}"
          ${bought || !game.meta.quotaMet || game.meta.gold < cost ? 'disabled' : ''}>${bought ? 'Готово' : cost + ' др.'}</button></div>`;
      }).join('')}
      <p id="shop-notice" role="status">${shopNotice}</p>`;
  } else if (currentMenu === 'result' && game.result) {
    const result = game.result;
    const details: Record<string, string> = {
      quota: 'Квота не выполнена. Улов и опыт вылазки потеряны.',
      wrath: 'Последняя волна накрыла лодку. Улов и опыт вылазки потеряны.',
      health: 'Одиссей не смог продолжить. Улов и опыт вылазки потеряны.'
    };
    menuContent.innerHTML = `${heading(result.success ? 'Улов доставлен' : 'Вылазка сорвалась',
      locationInfo[result.zone as LocationSlot].name, false)}
      <p class="panel-text">${result.success ? 'Улов можно продать в лавке на причале.' : details[result.reason]}</p>
      <div class="report"><span><strong>${result.count + Number(!result.success && result.lostPending)}</strong>${result.success ? 'Рыб доставлено' : 'Рыб потеряно'}</span>
      <span><strong>${result.score} / ${game.balance.economy.quota}</strong>Квота</span>
      <span><strong>+${result.success ? result.xp : 0}</strong>Опыт</span>
      ${result.success ? `<span><strong>${result.value} др.</strong>Цена улова</span>` : ''}</div>
      <div class="button-row"><button class="primary" data-action="close-menu">К причалу</button></div>`;
  } else if (currentMenu === 'exit') {
    menuContent.innerHTML = `${heading('Вернуться раньше?', 'Квота не выполнена', false)}
      <p class="panel-text">Если уйти сейчас, улов и опыт этой вылазки пропадут.</p>
      <div class="button-row"><button data-action="close-menu">Продолжить рыбалку</button>
      <button data-action="confirm-return">Вернуться без улова</button></div>`;
  }

  if (previous?.action) {
    const replacement = [...menuContent.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.dataset.action === previous.action && button.dataset.id === previous.id && !button.disabled
    );
    (replacement ?? menuContent.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
  }
}

function renderWater() {
  const run = game.run;
  if (!run) return;

  const { phase } = run;
  if (!zoneIntro.hidden && performance.now() >= arrivalUntil) zoneIntro.hidden = true;
  const stage = game.stage;
  water.dataset.stage = String(stage);
  setText(hud.stage, `${['I', 'II', 'III'][stage - 1]} · ${stages[stage - 1]}`);
  hud.wrath.value = run.wrath;
  setText(hud.wrathNumber, `${Math.round(run.wrath)}%`);
  setText(hud.quota, `${game.score} / ${game.balance.economy.quota}`);
  setText(hud.health, `${run.health} / ${game.balance.wrath.health}`);
  setText(hud.offerings, String(game.meta.offerings));
  setText(hud.notice, run.noticeFor > 0 ? run.notice : '');
  hud.holdButton.disabled = phase !== 'ready' || game.aiming;
  hud.offeringButton.disabled = !game.meta.offerings || phase === 'surge';
  hud.returnButton.disabled = phase === 'pack' || phase === 'surge' || inspectingHold;
  hud.attack.hidden = !game.monster;
  if (game.monster) setText(hud.attack, game.monster.windup > 0 ? 'Прислужник замахнулся!' : 'Прислужник идёт к лодке');
  hud.bow.disabled = phase === 'surge';
  hud.bow.setAttribute('aria-pressed', String(game.aiming));
  hud.bowMeter.hidden = !game.aiming;
  hud.draw.value = game.charge;
  hud.castMeter.hidden = game.aiming || !game.drawing;
  if (!hud.castMeter.hidden) {
    hud.castCharge.value = game.charge;
    const preview = game.castPreview;
    const range = preview ? Math.hypot(preview.point.x - game.position.x, preview.point.z - game.position.z) : 0;
    setText(hud.castDistance, `${range.toFixed(1)} м`);
  }
  sceneHost.classList.toggle('aiming', game.aiming || (!game.firstPerson && phase === 'ready' && hold.hidden));
  hud.timing.hidden = game.aiming || phase !== 'hook';
  hud.fight.hidden = game.aiming || (phase !== 'struggle' && phase !== 'reel');

  if (phase === 'hook') {
    const { bandStart, bandEnd } = game.balance.bite;
    hud.band.style.left = `${bandStart * 100}%`;
    hud.band.style.width = `${(bandEnd - bandStart) * 100}%`;
    hud.marker.style.left = `${game.marker * 100}%`;
    hud.timing.dataset.hit = String(game.marker >= bandStart && game.marker <= bandEnd);
  }
  if (!hud.fight.hidden) {
    hud.tension.value = run.tension;
    setText(hud.tensionNumber, `${Math.round(run.tension)}%`);
    hud.distance.max = game.balance.fight.maxDistance;
    hud.distance.value = run.distance;
    setText(hud.distanceNumber, `${run.distance.toFixed(1)} м`);
  }

  const direction = counter[run.direction as keyof typeof counter];
  const label = `${phase}|${phase === 'struggle' ? direction : ''}|${game.aiming}|${game.drawing}|${hasCast}`;
  if (label === lastPhaseLabel) return;
  lastPhaseLabel = label;
  hud.phase.dataset.phase = phase;
  hud.phase.dataset.counter = phase === 'struggle' ? direction : '';
  const descriptions: Record<string, string> = {
    ready: game.drawing
      ? '<strong>Отпусти <kbd>ЛКМ</kbd>, когда кольцо попадёт в косяк</strong>'
      : hasCast
        ? '<span><kbd>ЛКМ</kbd> Заброс <kbd>WASD</kbd> Лодка</span>'
        : '<strong>Забрось к рыбе</strong><span>Удерживай <kbd>ЛКМ</kbd> для выбора дальности. Лодка <kbd>WASD</kbd></span>',
    cast: '<strong>Поплавок в полёте</strong>',
    wait: '<span>Следи за поплавком</span>',
    hook: '<button data-action="primary">Подсечь <kbd>Пробел</kbd></button><span>Нажми в зелёной зоне</span>',
    struggle: direction === 'left'
      ? '<strong>Тяни влево</strong><span><kbd>A</kbd> / <kbd>←</kbd></span>'
      : '<strong>Тяни вправо</strong><span><kbd>D</kbd> / <kbd>→</kbd></span>',
    reel: '<strong>Подматывай</strong><span>Удерживай <kbd>Пробел</kbd></span>',
    pack: '<strong>Рыба поймана</strong>',
    surge: '<strong>Последняя волна</strong>'
  };
  hud.phase.innerHTML = game.aiming
    ? '<strong>Лук в руках</strong><span>Удерживай <kbd>ЛКМ</kbd> для натяжения, отпусти для выстрела</span>'
    : descriptions[phase];
}

function renderHold(focus = false) {
  const run = game.run;
  const pending = run?.phase === 'pack' ? run.pending : null;
  const previous = hold.contains(document.activeElement) && document.activeElement instanceof HTMLButtonElement
    ? document.activeElement.dataset : null;
  hold.hidden = !run || game.aiming || (!pending && !inspectingHold);
  cover.hidden = hold.hidden;
  gameHeader.inert = water.inert = waterInspector.inert = !hold.hidden;
  if (hold.hidden || !run) {
    if (previous && run) water.focus({ preventScroll: true });
    return;
  }

  const { columns, rows } = run.grid;
  const cells = Array.from({ length: columns * rows }, (_, i) => {
    const x = i % columns;
    const y = Math.floor(i / columns);
    return `<button class="cell" data-action="cell" data-x="${x}" data-y="${y}"
      style="grid-area:${y + 1} / ${x + 1}" aria-label="Ячейка ${x + 1}, ${y + 1}" ${pending ? '' : 'disabled'}></button>`;
  }).join('');
  const cargo = run.cargo.map(item => {
    const [w, h] = game.dimensions(item);
    const kind = fish[item.id as FishId];
    return `<div class="cargo-item" style="--fish:${kind.color};grid-area:${item.y + 1} / ${item.x + 1} / span ${h} / span ${w}">${kind.name} · ${item.count}</div>`;
  }).join('');
  const releaseOptions = run.cargo.map(item => `<button data-action="release-old" data-id="${item.key}">Выпустить · ${fish[item.id as FishId].name}</button>`).join('');
  const size = pending ? game.dimensions(pending).join(' × ') : '';
  const kind = pending ? fish[pending.id as FishId] : null;
  const stack = run.cargo.some(item => item.id === pending?.id && item.count < game.balance.economy.stackLimit);
  hold.innerHTML = `<header class="panel-head"><div><span class="eyebrow">Квота · ${game.score} / ${game.balance.economy.quota}</span>
    <h2 id="hold-title">${pending ? 'Уложить улов' : 'Трюм'}</h2></div>
    ${pending ? '' : '<button data-action="hold" aria-label="Закрыть трюм">×</button>'}</header>
    ${kind && pending ? `<div class="pending" style="--fish:${kind.color}"><strong>${kind.name}</strong><span>${kind.tier} · ${size} · ${price(pending.id as FishId)} др.</span></div>
    <p class="panel-text">Выбери левую верхнюю ячейку для рыбы.</p>` : ''}
    <div class="cargo-grid" style="--cols:${columns};--rows:${rows}">${cells}${cargo}</div>
    <div class="cargo-actions">${releaseOptions}</div>
    ${pending ? `<div class="button-row"><button data-action="rotate">Повернуть <kbd>R</kbd></button>
      <button data-action="stack" ${stack ? '' : 'disabled'}>Сложить с такой же</button><button data-action="release">Выпустить рыбу</button></div>` : ''}
    <p id="hold-note" role="status"></p>`;
  const buttons = [...hold.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const replacement = previous && buttons.find(button => button.dataset.action === previous.action
    && button.dataset.id === previous.id && button.dataset.x === previous.x && button.dataset.y === previous.y);
  if (replacement || previous || focus) (replacement || buttons[0])?.focus();
}

function highlightCell(cell: HTMLElement | null) {
  const pending = game.run?.pending;
  for (const previous of hold.querySelectorAll<HTMLElement>('[data-preview]')) delete previous.dataset.preview;
  if (!cell || !pending) return;
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  const [w, h] = game.dimensions(pending);
  const fit = game.fits(pending, x, y);
  for (const button of hold.querySelectorAll<HTMLButtonElement>('.cell')) {
    const col = Number(button.dataset.x);
    const row = Number(button.dataset.y);
    if (col >= x && col < x + w && row >= y && row < y + h) {
      button.dataset.preview = fit ? 'fits' : 'blocked';
    }
  }
}

function processEvents() {
  for (const event of game.events.splice(0)) {
    switch (event.name) {
      case 'start': {
        const info = locationInfo[game.run!.zone.id as LocationSlot];
        byId('dock').hidden = true;
        water.hidden = false;
        gameRoot.dataset.expedition = 'true';
        byId('zone-name').textContent = info.name;
        byId('zone-description').textContent = info.description;
        zoneIntro.hidden = false;
        arrivalUntil = performance.now() + 3600;
        hasCast = false;
        lastPhaseLabel = '';
        water.focus({ preventScroll: true });
        save();
        break;
      }
      case 'catch':
        clearInputs();
        if (game.run) renderHold(true);
        break;
      case 'pack':
        renderHold();
        break;
      case 'phase':
        if (game.run?.phase === 'surge') {
          inspectingHold = false;
          clearInputs();
          renderHold();
        }
        break;
      case 'finish':
        game.aiming = false;
        inspectingHold = false;
        renderHold();
        save();
        showDock();
        showMenu('result');
        break;
      case 'offering':
        save();
        break;
    }
  }
}

async function sail() {
  if (!scene || loadingLocation || (selectedZone === 'temple' && !game.meta.boat)) return;
  const request = new AbortController();
  const zone = selectedZone;
  loadingLocation = request;
  mapNotice = '';
  renderMenu();
  let unattached: LoadedLocation | undefined;
  let attached = false;
  try {
    unattached = await loadLocation(zone, request.signal);
    if (loadingLocation !== request) return;
    const { layout } = unattached;
    scene.setLocation(unattached);
    unattached = undefined;
    attached = true;
    if (!game.start(zone, layout)) throw new Error(`Could not start expedition: ${zone}`);
  } catch (error) {
    if (attached) scene.clearLocation();
    if (request.signal.aborted) return;
    mapNotice = 'Локация не загрузилась. Попробуй выйти на воду ещё раз.';
    console.warn('Location could not be loaded', error);
    return;
  } finally {
    if (unattached) disposeLocation(unattached.root);
    if (loadingLocation === request) {
      loadingLocation = null;
      request.abort();
      if (mapNotice) renderMenu();
    }
  }
  closeMenu();
  processEvents();
  renderWater();
}

function action(button: HTMLButtonElement) {
  const { action, id } = button.dataset;
  if (water.contains(button)) zoneIntro.hidden = true;
  switch (action) {
    case 'water-settings':
      toggleWaterInspector();
      break;
    case 'shop':
      shopNotice = '';
      showMenu('shop');
      break;
    case 'map':
      selectedZone = 'pond';
      mapNotice = '';
      showMenu('map');
      break;
    case 'zone':
      if (id === 'pond' || id === 'temple') selectedZone = id;
      mapNotice = '';
      renderMenu();
      break;
    case 'sail':
      void sail();
      break;
    case 'close-menu':
      closeMenu();
      break;
    case 'sell':
      shopNotice = `За улов получено ${game.sell()} др.`;
      save();
      updateDock();
      renderMenu();
      break;
    case 'buy':
      if (id && game.buy(id)) {
        shopNotice = id === 'boat' ? 'Лодка готова. Гавань затонувшего лика открыта.' : 'Покупка сделана.';
        save();
        updateDock();
        renderMenu();
      }
      break;
    case 'primary':
      if (hold.hidden) game.primary();
      break;
    case 'offering':
      game.offering();
      break;
    case 'bow':
      toggleBow();
      break;
    case 'return':
      if (game.score >= game.balance.economy.quota) game.finish();
      else showMenu('exit');
      break;
    case 'confirm-return':
      closeMenu();
      game.finish();
      break;
    case 'hold':
      if (game.run?.phase === 'ready') {
        clearInputs();
        inspectingHold = !inspectingHold;
        renderHold(inspectingHold);
        if (!inspectingHold) hud.holdButton.focus();
      }
      break;
    case 'cell':
      if (game.run?.pending && !game.pack(Number(button.dataset.x), Number(button.dataset.y))) {
        byId('hold-note').textContent = 'Рыба не помещается. Выбери другую ячейку, поверни или освободи место.';
      }
      break;
    case 'rotate':
      game.rotate();
      renderHold();
      hold.querySelector<HTMLButtonElement>('[data-action="rotate"]')?.focus();
      break;
    case 'stack':
      game.stack();
      break;
    case 'release':
      game.release(undefined);
      break;
    case 'release-old':
      game.release(Number(id));
      renderHold(true);
      break;
  }
  processEvents();
  renderWater();
}

document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (button && !button.disabled) action(button);
});

hold.addEventListener('pointerover', event => highlightCell((event.target as HTMLElement).closest('.cell')));
hold.addEventListener('pointerleave', () => highlightCell(null));
hold.addEventListener('focusin', event => highlightCell((event.target as HTMLElement).closest('.cell')));
hold.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const buttons = hold.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if ((!event.shiftKey && event.target === last) || (event.shiftKey && event.target === first)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
});

menu.addEventListener('cancel', event => {
  event.preventDefault();
  closeMenu();
});

function syncKeys() {
  game.inputs.clear();
  for (const input of keys.values()) game.inputs.add(input);
}

document.addEventListener('keydown', event => {
  if (event.target instanceof Node && waterInspector.contains(event.target)) {
    if (event.code === 'Escape') toggleWaterInspector();
    return;
  }
  const run = game.run;
  if (!run || menu.open || event.altKey || event.ctrlKey || event.metaKey) return;
  const focusedButton = event.target instanceof HTMLButtonElement ? event.target : null;
  if (event.code === 'Space' && focusedButton && (hold.contains(focusedButton)
    || focusedButton.dataset.action === 'primary' || (run.phase === 'ready' && focusedButton.matches(':focus-visible')))) return;
  const input = inputKeys[event.code];
  const bowKey = event.code === 'KeyF';
  const helm = helmKeys[event.code];
  const offering = event.code === 'KeyO';
  const rotate = event.code === 'KeyR' && run.phase === 'pack';
  const escape = event.code === 'Escape';
  if (!input && !helm && !bowKey && !offering && !rotate && !escape) return;
  if (input && !hold.hidden) return;
  zoneIntro.hidden = true;
  event.preventDefault();
  if (event.repeat) return;

  if (helm && hold.hidden && (run.phase === 'ready' || game.aiming)) game.helm.add(helm);
  if (input && !game.aiming && ['struggle', 'reel'].includes(run.phase)) {
    keys.set(event.code, input);
    syncKeys();
  } else if (input === 'reel') {
    game.primary();
  }
  if (bowKey) toggleBow();
  if (offering && run.phase !== 'surge') game.offering();
  if (rotate) {
    game.rotate();
    renderHold(true);
  }
  if (escape) {
    if (game.aiming) toggleBow();
    else if (inspectingHold) {
      inspectingHold = false;
      renderHold();
      hud.holdButton.focus();
    } else {
      game.cancel();
    }
    clearInputs();
  }
  processEvents();
  renderWater();
});

document.addEventListener('keyup', event => {
  if (keys.delete(event.code)) syncKeys();
  const helm = helmKeys[event.code];
  if (helm) game.helm.delete(helm);
});
sceneHost.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !scene || menu.open || !hold.hidden || drawPointer !== null) return;
  if (!(game.aiming ? game.beginDraw() : game.beginCast())) return;
  event.preventDefault();
  zoneIntro.hidden = true;
  water.focus({ preventScroll: true });
  drawPointer = event.pointerId;
  pointer = event;
  game.target = scene.pointAt(event.clientX, event.clientY, game.aiming);
  sceneHost.setPointerCapture(event.pointerId);
});
sceneHost.addEventListener('pointermove', event => {
  if ((!game.aiming && !game.drawing) || (drawPointer !== null && event.pointerId !== drawPointer)) return;
  pointer = event;
  game.target = scene?.pointAt(event.clientX, event.clientY, game.aiming) ?? null;
});
sceneHost.addEventListener('pointerup', event => {
  if (drawPointer !== event.pointerId) return;
  drawPointer = null;
  game.target = scene?.pointAt(event.clientX, event.clientY, game.aiming) ?? null;
  if (game.aiming) game.releaseArrow();
  else {
    hasCast = true;
    game.releaseCast();
  }
  processEvents();
  renderWater();
});
for (const kind of ['pointercancel', 'lostpointercapture']) {
  sceneHost.addEventListener(kind, event => {
    if ((event as PointerEvent).pointerId !== drawPointer) return;
    drawPointer = null;
    game.abortDraw();
  });
}
window.addEventListener('blur', clearInputs);
document.addEventListener('visibilitychange', clearInputs);

let previousFrame = performance.now();
function frame(now: number) {
  const dt = Math.min((now - previousFrame) / 1000, .05);
  previousFrame = now;
  if (game.run && !menu.open && !document.hidden) {
    if ((game.aiming || game.drawing) && pointer) game.target = scene?.pointAt(pointer.clientX, pointer.clientY, game.aiming) ?? null;
    game.step(dt);
    processEvents();
    renderWater();
  }
  scene?.update(dt);
  requestAnimationFrame(frame);
}

showDock();
requestAnimationFrame(frame);
