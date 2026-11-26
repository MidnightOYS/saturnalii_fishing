import './style.css';
import './visual-inspector.css';
import './hud-tide/theme.css';
import './polyphemus/style.css';
import './hud-tide/red-figure-tokens.css';
import './ithaca.css';
import { cargoCells, rotateCargo, type Cargo } from './cargo';
import { counter, fish, zones } from './rules/game.js';
import { readArtelSave, type ArtelBuilding } from './artel';
import { enemyNames, enemyTiming } from './enemies';
import { actionCost, distance, Expedition } from './expedition';
import { conditionNames, readPolyphemusSave, stakeKey } from './polyphemus/rules';
import { bindPolyphemusFrame, polyphemusResult, polyphemusRound, polyphemusSetup } from './polyphemus/view';
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
type Menu = 'map' | 'shop' | 'workshop' | 'result' | 'polyphemus' | 'tasks' | 'shrine' | 'observatory';
const menuBuilding: Partial<Record<Menu, ArtelBuilding>> = {
  shop: 'market', workshop: 'station', shrine: 'shrine', observatory: 'observatory',
};
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

function paintMeter(progress: HTMLProgressElement, value: number) {
  progress.value = value;
  const clip = 91.25 - 82.5 * progress.value / progress.max;
  progress.parentElement?.style.setProperty('--tide-clip', `${clip}%`);
}

function readProgress(): Partial<Meta> {
  try {
    const saved = JSON.parse(localStorage.getItem(saveKey) ?? '{}');
    const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;
    const sales = Object.fromEntries(Object.keys(fish)
      .filter(id => count(saved?.sales?.[id]) > 0)
      .map(id => [id, count(saved.sales[id])]));
    return {
      gold: count(saved?.gold), xp: count(saved?.xp), sales, ...readPolyphemusSave(saved), artel: readArtelSave(saved),
      boat: saved?.boat === true, line: saved?.line === true,
      quotaMet: saved?.quotaMet === true, visitedTemple: saved?.visitedTemple === true,
      ...(saved?.offerings === undefined ? {} : { offerings: count(saved.offerings) })
    };
  } catch {
    return {};
  }
}

const game = new Expedition(readProgress());
const gameRoot = byId('game');
const touchLayout = matchMedia('(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 540px) and (orientation: landscape)');
const { bandStart, bandEnd } = game.balance.bite;
function updateTouchLayout() {
  const mobile = touchLayout.matches;
  gameRoot.toggleAttribute('data-mobile-controls', mobile);
  // A wider visible timing band makes the hook practical with a thumb tap.
  game.balance.bite.bandStart = mobile ? bandStart - .08 : bandStart;
  game.balance.bite.bandEnd = mobile ? bandEnd + .08 : bandEnd;
}
updateTouchLayout();
const sceneHost = byId('scene');
let scene: ReturnType<typeof createScene> | undefined;
try {
  scene = createScene(sceneHost, game, {
    shop: byId('dock-shop'), workshop: byId('dock-workshop'),
    polyphemus: byId('dock-polyphemus'), map: byId('dock-boat'),
    tasks: byId('dock-tasks'), shrine: byId('dock-shrine'), observatory: byId('dock-observatory'),
  });
} catch (error) {
  byId('render-error').hidden = false;
  byId('dock-status').textContent = '';
  console.warn('WebGL scene initialization failed', error);
}

const menu = byId<HTMLDialogElement>('menu');
const waterInspector = byId('game-water-inspector');
const waterSettingsToggle = byId<HTMLButtonElement>('water-settings-toggle');
if (scene) {
  let profile = defaultCollection(true);
  try {
    const saved = localStorage.getItem(waterSaveKey);
    if (saved) profile = readCollection(JSON.parse(saved), profile);
  } catch {
    // Use the collection defaults if settings cannot be read.
  }
  scene.selectWater(profile.mode, profile.modes[profile.mode]);
  const waterControls = makeLabUI((mode, settings, snapshot) => {
    scene?.selectWater(mode, settings);
    try {
      localStorage.setItem(waterSaveKey, JSON.stringify(snapshot));
    } catch {
      // Settings still apply to the current session.
    }
  }, undefined, { root: byId('game-water-controls'), initial: profile, game: true });
  makeVisualInspector(waterInspector, tuning => {
    scene?.setVisualTuning(tuning);
    byId('game').style.setProperty('--expedition-vignette', String(tuning.vignette));
  }, waterControls.getSnapshot);
} else {
  waterSettingsToggle.disabled = true;
}
const menuContent = byId('menu-content');
const water = byId('fishing');
const gameHeader = byId('game-header');
const zoneIntro = byId('zone-intro');
const hold = byId('hold');
const cover = document.createElement('div');
cover.className = 'hold-cover';
cover.hidden = true;
hold.before(cover);

const hud = {
  stage: byId('stage'), wrath: byId<HTMLProgressElement>('wrath'), wrathNumber: byId('wrath-number'),
  health: byId('health'), stamina: byId<HTMLProgressElement>('stamina'), staminaNumber: byId('stamina-number'),
  notice: byId('notice'),
  phase: byId('phase'), timing: byId('timing'), band: byId('timing-band'), marker: byId('marker'),
  fight: byId('fight'), tension: byId<HTMLProgressElement>('tension'), tensionNumber: byId('tension-number'),
  distance: byId<HTMLProgressElement>('distance'), distanceNumber: byId('distance-number'), attack: byId('attack'),
  bowMeter: byId('bow-meter'), draw: byId<HTMLProgressElement>('bow-draw'),
  mobileCast: byId<HTMLButtonElement>('mobile-cast'), mobileBow: byId<HTMLButtonElement>('mobile-bow'),
  mobileDash: byId<HTMLButtonElement>('mobile-dash'), mobileFish: byId<HTMLButtonElement>('mobile-fish-action'), mobileSteer: byId('mobile-steer'),
  castMeter: byId('cast-meter'), castCharge: byId<HTMLProgressElement>('cast-charge'), castDistance: byId('cast-distance'),
  holdButton: water.querySelector<HTMLButtonElement>('[data-action="hold"]')!,
  returnButton: water.querySelector<HTMLButtonElement>('[data-action="return"]')!
};

const keys = new Map<string, Input>();
const touchKeys = new Map<number, Input>();
const inputKeys: Partial<Record<string, Input>> = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'reel'
};
const helmKeys: Partial<Record<string, string>> = {
  KeyW: 'north', KeyS: 'south', KeyA: 'west', KeyD: 'east'
};
let drawPointer: number | null = null;
let pointer: { clientX: number; clientY: number } | null = null;
let waterTap: { id: number; x: number; y: number } | null = null;
let mobileCastArmed = false;
const stages = ['Волны', 'Волны и чудовища', 'Критический гнев'];
let currentMenu: Menu | null = null;
let selectedZone: LocationSlot = 'pond';
let loadingLocation: AbortController | null = null;
let mapNotice = '';
let artelNotice = '';
let shopSalesExpanded = false;
let selectedStake = '';
let paintPolyphemus: ReturnType<typeof bindPolyphemusFrame> | null = null;
let inspectingHold = false;
let cargoDraft: Cargo | null = null;
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
  for (const id of ['shrine', 'observatory'] as const) {
    byId(`dock-${id}`).toggleAttribute('data-unbuilt', !game.meta.artel.buildings[id]);
  }
  byId('dock-goal').textContent = game.hull === 0
    ? 'Перед выходом почини корпус на лодочной станции.'
    : 'Продай улов на рынке и вложи выручку в развитие артели.';
}

function showDock() {
  byId('dock').hidden = false;
  water.hidden = true;
  delete gameRoot.dataset.expedition;
  updateDock();
}

function clearInputs() {
  keys.clear();
  touchKeys.clear();
  game.inputs.clear();
  game.helm.clear();
  game.clearMoveTarget();
  if (drawPointer !== null && game.aiming && !touchLayout.matches) game.toggleBow();
  game.abortDraw();
  drawPointer = null;
  pointer = null;
  waterTap = null;
  mobileCastArmed = false;
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
  if (name !== currentMenu) {
    loadingLocation?.abort();
    loadingLocation = null;
  }
  currentMenu = name;
  if (!menu.open) {
    focusAfterDialog = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  renderMenu();
  if (!menu.open) menu.showModal();
}

function closeMenu() {
  if (currentMenu === 'polyphemus') {
    if (game.polyphemus.round) return;
    game.polyphemus.outcome = null;
    paintPolyphemus = null;
  }
  const fromResult = currentMenu === 'result';
  if (fromResult) game.result = null;
  loadingLocation?.abort();
  loadingLocation = null;
  currentMenu = null;
  delete menu.dataset.mode;
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

function artelRow(name: string, effect: string, action: string, label: string, disabled: boolean, id = '') {
  return `<div class="menu-row artel-row"><div><strong>${name}</strong><small>${effect}</small></div>
    <button type="button" data-action="${action}" data-id="${id}" aria-label="${name} · ${label}"
      ${disabled ? 'disabled' : ''}>${label}</button></div>`;
}

function buildingRow(id: ArtelBuilding, name: string, effect: string) {
  const level = game.meta.artel.buildings[id];
  const cost = game.artelUpgradePrice(id);
  const label = cost === null ? 'Макс. уровень' : `${level ? 'Улучшить' : 'Построить'} · ${cost} др.`;
  return artelRow(name, level ? `Уровень ${level}. ${effect}` : effect,
    'artel-build', label, cost === null || game.meta.gold < cost, id);
}

function artelStatus() {
  return `<p class="artel-notice" role="status">${artelNotice}</p>`;
}

function renderMenu() {
  const previous = menuContent.contains(document.activeElement) && document.activeElement instanceof HTMLButtonElement
    ? document.activeElement.dataset : null;

  const parlor = game.polyphemus;
  paintPolyphemus = null;
  if (currentMenu === 'polyphemus') {
    menu.dataset.mode = 'polyphemus';
    if (parlor.round) {
      menuContent.innerHTML = heading('Пари Полифема', 'Итака', false) + polyphemusRound(parlor.round);
      paintPolyphemus = bindPolyphemusFrame(menuContent);
      menuContent.querySelector<HTMLButtonElement>('[data-action="poly-cashout"]')?.focus();
    } else if (parlor.outcome) {
      const title = parlor.outcome.kind === 'paid' ? 'Цена зафиксирована' : 'Пасть сомкнулась';
      menuContent.innerHTML = heading(title, 'Пари Полифема') + polyphemusResult(parlor, game.meta.gold);
      menuContent.querySelector<HTMLButtonElement>('[data-action="poly-again"]')?.focus();
    } else {
      menuContent.innerHTML = heading('Пари Полифема', 'Итака') + polyphemusSetup(parlor, game.meta.gold, selectedStake);
    }
    return;
  }

  delete menu.dataset.mode;
  if (currentMenu === 'map') {
    const locked = !game.unlocked(selectedZone);
    const cards = zones.map(zone => {
      const id = zone.id as LocationSlot;
      const info = locationInfo[id];
      const isLocked = !game.unlocked(id);
      return `<button class="location" data-action="zone" data-id="${id}" data-locked="${isLocked}" aria-pressed="${selectedZone === id}" ${loadingLocation ? 'disabled' : ''}>
        <span class="eyebrow">${zone.number}</span><strong>${info.name}</strong>
        <small>${info.description}</small>${isLocked ? '<p>Исследуй локацию в обсерватории</p>' : ''}</button>`;
    }).join('');
    menuContent.innerHTML = `${heading('Выбор места', 'Вылазка')}<div class="locations">${cards}</div>
      <div class="button-row"><span>Корпус · ${game.hull} / ${game.maxHull}</span>
      ${game.hull <= 0 ? '<button data-action="workshop">К лодочной станции</button>' : ''}
      ${locked ? '<button data-action="observatory">К обсерватории</button>' : ''}
      <button class="primary" data-action="sail" ${locked || !game.hull || loadingLocation || !scene ? 'disabled' : ''}>Выйти на воду</button></div>
      <p class="map-notice" role="status">${loadingLocation ? 'Готовим лодку и локацию…' : mapNotice}</p>`;
  } else if (currentMenu === 'shop') {
    const catchForSale = parlor.inventory();
    const value = game.saleValue;
    const bonus = value - catchForSale.reduce((sum, item) => sum + item.price * item.count, 0);
    const debt = game.meta.artel.repairDebt;
    const rodCost = game.rodPrice;
    const rodEffect = rodCost !== null ? 'Новая удочка увеличивает дальность заброса.'
      : game.artelUpgradePrice('market') === null ? 'Лучшая удочка снаряжена.' : 'Следующая удочка требует улучшения рынка.';
    const label = (item: typeof catchForSale[number]) => fish[item.id].name
      + (item.condition ? ` (${conditionNames[item.condition].toLowerCase()})` : '');
    const catchNames = catchForSale.map(item => `${label(item)} × ${item.count}`).join(' · ');
    menuContent.innerHTML = `${heading('Рыбацкий рынок', `Итака · ${game.meta.gold} др.`)}
      <div class="menu-row"><div><strong>Улов на продажу</strong><small>${catchNames || 'Пока пусто'}</small></div>
      <button class="primary" data-action="sell" ${catchForSale.length ? '' : 'disabled'}>Продать · ${value} др.</button></div>
      ${bonus > 0 ? `<p class="artel-bonus">Бонус за объём улова · +${bonus} др.</p>` : ''}
      ${debt > 0 ? `<p class="panel-text">С выручки удерживается долг за ремонт · ${debt} др.</p>` : ''}
      ${catchForSale.length ? `<details class="harbor-fish-sales" ${shopSalesExpanded ? 'open' : ''}>
        <summary>Продать одну рыбу</summary><ul>${catchForSale.map(item => {
          const unitPrice = game.salePrice(item);
          return `<li><span>${label(item)} · ${item.count} шт.</span><button type="button" data-action="sell-one"
            data-id="${stakeKey(item)}" aria-label="Продать одну · ${label(item)} · ${unitPrice} др.">+${unitPrice} др.</button></li>`;
        }).join('')}</ul>
      </details>` : ''}
      ${buildingRow('market', 'Рыбацкий рынок', 'Улучшение открывает следующую удочку.')}
      ${artelRow('Удочка', `Уровень ${game.meta.artel.rod + 1}. ${rodEffect}`,
      'artel-rod', rodCost === null ? 'Недоступно' : `Купить · ${rodCost} др.`,
      rodCost === null || game.meta.gold < rodCost)}
      ${artelStatus()}`;
  } else if (currentMenu === 'workshop') {
    const canRepairOnCredit = game.hull === 0 && game.meta.gold < game.repairPrice;
    const holdCost = game.holdPrice;
    menuContent.innerHTML = `${heading('Лодочная станция', `Итака · ${game.meta.gold} др.`)}
      ${artelRow('Корпус лодки', `Прочность ${game.hull} / ${game.maxHull}.`,
        'artel-repair', game.hull >= game.maxHull ? 'Исправен'
          : canRepairOnCredit ? `В долг · ${game.repairPrice} др.` : `Починить · ${game.repairPrice} др.`,
        game.hull >= game.maxHull || (!canRepairOnCredit && game.meta.gold < game.repairPrice))}
      ${buildingRow('station', 'Лодочная станция', 'Улучшение укрепляет корпус и ускоряет ход лодки.')}
      ${artelRow('Расширение трюма', `Уровень ${game.meta.artel.holdLevel + 1}. Дополнительное место под улов.`,
        'artel-hold', holdCost === null ? 'Недоступно' : `Расширить · ${holdCost} др.`,
        holdCost === null || game.meta.gold < holdCost)}
      ${artelStatus()}`;
  } else if (currentMenu === 'tasks') {
    menuContent.innerHTML = `${heading('Доска заданий', `Итака · ${game.meta.gold} др.`)}
      ${game.artelTasks.map(task => artelRow(task.title, `${Math.min(task.progress, task.target)} / ${task.target}`,
        'artel-claim', task.claimed ? 'Получено' : `Забрать · ${task.reward} др.`,
        task.claimed || task.progress < task.target, task.id)).join('')}
      ${artelStatus()}`;
  } else if (currentMenu === 'shrine') {
    menuContent.innerHTML = `${heading('Святилище Посейдона', `Итака · ${game.meta.gold} др.`)}
      ${buildingRow('shrine', 'Святилище Посейдона', 'Каждый уровень замедляет накопление гнева во время вылазки.')}
      ${artelStatus()}`;
  } else if (currentMenu === 'observatory') {
    const cost = game.researchPrice('temple');
    const known = game.unlocked('temple');
    const reason = game.meta.artel.buildings.observatory ? 'Доступно для исследования' : 'Сначала построй обсерваторию';
    menuContent.innerHTML = `${heading('Обсерватория', `Итака · ${game.meta.gold} др.`)}
      ${buildingRow('observatory', 'Обсерватория', 'Открывает исследования новых мест для вылазок.')}
      ${artelRow(locationInfo.temple.name, known ? 'Доступна на карте вылазок' : reason,
        'artel-research', known ? 'Открыта' : cost === null ? 'Закрыта' : `Исследовать · ${cost} др.`,
        known || cost === null || game.meta.gold < cost, 'temple')}
      ${artelStatus()}`;
  } else if (currentMenu === 'result' && game.result) {
    const result = game.result;
    const details = result.reason === 'wrath'
      ? 'Гнев Посейдона достиг 100%. Улов вылазки потерян.'
      : 'Корпус разрушен. Улов вылазки потерян, лодку можно починить на Итаке.';
    menuContent.innerHTML = `${heading(result.success ? (result.count ? 'Улов доставлен' : 'Возвращение на Итаку') : 'Вылазка сорвалась',
      locationInfo[result.zone as LocationSlot].name, false)}
      <div class="tide-result-art" data-outcome="${result.success ? 'success' : 'failure'}" aria-hidden="true"></div>
      <p class="panel-text">${result.success
        ? (result.count ? 'Улов можно продать на рыбацком рынке.' : 'Лодка у причала, вылазка завершена.')
        : details}</p>
      <div class="report"><span><strong>${result.count + Number(!result.success && result.lostPending)}</strong>${result.success ? 'Рыб доставлено' : 'Рыб потеряно'}</span>
      <span><strong>${game.hull} / ${game.maxHull}</strong>Прочность</span>
      ${result.success ? `<span><strong>+${result.xp}</strong>Опыт</span><span><strong>${result.value} др.</strong>Цена улова</span>` : ''}</div>
      <div class="button-row"><button class="primary" data-action="close-menu">На Итаку</button></div>`;
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
  paintMeter(hud.wrath, run.wrath);
  setText(hud.wrathNumber, `${Math.floor(run.wrath)}%`);
  setText(hud.health, `${run.health} / ${game.maxHull}`);
  paintMeter(hud.stamina, game.stamina);
  setText(hud.staminaNumber, `${Math.floor(game.stamina)}%`);
  hud.stamina.parentElement?.toggleAttribute('data-insufficient', game.stamina < actionCost);
  setText(hud.notice, run.noticeFor > 0 ? run.notice : '');
  hud.holdButton.disabled = phase === 'surge';
  hud.returnButton.disabled = phase !== 'ready' || !hold.hidden;
  const returnPoint = game.returnPoint;
  setText(hud.returnButton, game.atReturnPoint ? 'На Итаку'
    : returnPoint ? `К причалу · ${Math.ceil(distance(game.position, returnPoint))} м` : 'К причалу');
  const waveWarning = game.waves.some(wave => wave.age < wave.warningTime);
  hud.attack.hidden = !game.monster && !waveWarning;
  if (game.monster) {
    const threat = game.monster.windup > 0 ? 'готовит удар!'
      : game.monster.age < enemyTiming.emerge ? 'всплывает' : 'идёт к лодке';
    setText(hud.attack, `${enemyNames[game.monster.kind]} ${threat}${waveWarning ? ' · Волна' : ''}`);
  } else if (waveWarning) {
    setText(hud.attack, 'Волна · выйди из красной полосы');
  }
  const mobile = touchLayout.matches;
  if (phase !== 'ready') mobileCastArmed = false;
  hud.mobileCast.disabled = phase !== 'ready';
  hud.mobileCast.setAttribute('aria-pressed', String(mobileCastArmed));
  hud.mobileDash.disabled = phase !== 'ready' || game.aiming || game.stamina < actionCost;
  hud.mobileBow.disabled = phase === 'surge' || (!game.aiming && (Boolean(game.arrow) || game.stamina < actionCost));
  hud.mobileBow.setAttribute('aria-pressed', String(game.aiming));
  hud.mobileFish.hidden = !mobile || game.aiming || (phase !== 'hook' && phase !== 'reel');
  hud.mobileSteer.hidden = !mobile || game.aiming || phase !== 'struggle';
  if (!hud.mobileFish.hidden) setText(hud.mobileFish, phase === 'hook' ? 'Подсечь' : 'Подматывать');
  for (const [id, input] of touchKeys) {
    if (input === 'reel' ? hud.mobileFish.hidden || phase !== 'reel' : hud.mobileSteer.hidden) {
      touchKeys.delete(id);
      syncKeys();
    }
  }
  hud.bowMeter.hidden = !game.aiming || mobile;
  paintMeter(hud.draw, game.charge);
  hud.castMeter.hidden = game.aiming || !game.drawing;
  if (!hud.castMeter.hidden) {
    paintMeter(hud.castCharge, game.charge);
    const preview = game.castPreview;
    const range = preview ? Math.hypot(preview.point.x - game.position.x, preview.point.z - game.position.z) : 0;
    const specialSchool = preview?.school?.expiresAt !== undefined;
    setText(hud.castDistance, specialSchool ? `${range.toFixed(1)} м · Особый косяк` : `${range.toFixed(1)} м`);
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
    paintMeter(hud.tension, run.tension);
    setText(hud.tensionNumber, `${Math.round(run.tension)}%`);
    hud.distance.max = game.balance.fight.maxDistance;
    paintMeter(hud.distance, run.distance);
    setText(hud.distanceNumber, `${run.distance.toFixed(1)} м`);
  }

  const direction = counter[run.direction as keyof typeof counter];
  const label = `${phase}|${phase === 'struggle' ? direction : ''}|${game.aiming}|${game.drawing}|${hasCast}|${mobile}|${mobileCastArmed}`;
  if (label === lastPhaseLabel) return;
  lastPhaseLabel = label;
  hud.phase.dataset.phase = phase;
  hud.phase.dataset.counter = phase === 'struggle' ? direction : '';
  if (mobile) {
    const hints: Record<string, string> = {
      ready: mobileCastArmed ? 'Коснись воды у косяка' : 'Коснись воды, чтобы направить лодку',
      cast: 'Поплавок в полёте',
      wait: 'Следи за поплавком',
      hook: 'Подсеки в зелёной зоне',
      struggle: direction === 'left' ? 'Удерживай ←' : 'Удерживай →',
      reel: 'Удерживай «Подматывать»',
      pack: 'Рыба поймана',
      surge: 'Последняя волна',
    };
    hud.phase.textContent = game.aiming ? 'Коснись цели, чтобы выстрелить' : hints[phase];
    return;
  }
  const descriptions: Record<string, string> = {
    ready: game.drawing
      ? '<strong>Отпусти <kbd>ЛКМ</kbd>, когда кольцо попадёт в косяк</strong>'
      : hasCast
        ? '<span><kbd>ЛКМ</kbd> Заброс <kbd>ПКМ</kbd> Лук <kbd>WASD</kbd> Лодка <kbd>Пробел</kbd> Рывок</span>'
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
    ? '<strong>Лук в руках</strong><span>Удерживай <kbd>ПКМ</kbd> для натяжения, отпусти для выстрела</span>'
    : descriptions[phase];
}

function toggleHold() {
  const run = game.run;
  if (!run || run.phase === 'surge' || run.pending) return false;
  clearInputs();
  inspectingHold = !inspectingHold;
  renderHold(inspectingHold);
  if (!inspectingHold) hud.holdButton.focus();
  return true;
}

function renderHold(focus = false) {
  const run = game.run;
  const pending = run?.phase === 'pack' ? run.pending : null;
  const previous = hold.contains(document.activeElement) && document.activeElement instanceof HTMLButtonElement
    ? document.activeElement.dataset : null;
  hold.hidden = !run || run.phase === 'surge' || (!pending && !inspectingHold);
  cover.hidden = hold.hidden;
  gameHeader.inert = water.inert = waterInspector.inert = !hold.hidden;
  if (hold.hidden || !run) {
    cargoDraft = null;
    if (previous && run) water.focus({ preventScroll: true });
    return;
  }

  const { columns, rows } = run.grid;
  const placements = new Map<number, { item: Cargo; icon: boolean }>();
  for (const item of run.cargo) {
    cargoCells(item).forEach(({ x, y }, index) => placements.set(y * columns + x, { item, icon: index === 0 }));
  }
  const cells = Array.from({ length: columns * rows }, (_, i) => {
    const x = i % columns;
    const y = Math.floor(i / columns);
    const placement = placements.get(i);
    const item = placement?.item;
    const kind = item ? fish[item.id] : null;
    const label = `Ячейка ${x + 1}, ${y + 1}${kind ? ` · ${kind.name}` : ''}`;
    return `<button class="cell" data-action="cell" data-x="${x}" data-y="${y}"
      ${item ? `data-cargo="${item.key}" data-fish="${item.id}"` : ''}
      ${item && cargoDraft?.key === item.key ? 'data-draft' : ''}
      style="grid-area:${y + 1} / ${x + 1}${kind ? `;--fish:${kind.color}` : ''}"
      aria-label="${label}" ${item || pending || cargoDraft ? '' : 'disabled'}>
      ${placement?.icon ? '<span class="cargo-cell-icon" aria-hidden="true"></span>' : ''}</button>`;
  }).join('');
  const fishButtons = run.cargo.map(item => `<button data-action="select-cargo" data-id="${item.key}"
    aria-pressed="${cargoDraft?.key === item.key}">${fish[item.id].name}${item.count > 1 ? ` ×${item.count}` : ''}</button>`).join('');
  const kind = pending ? fish[pending.id as FishId] : null;
  const moving = cargoDraft ? fish[cargoDraft.id].name : '';
  const hint = moving ? `Выбери новую ячейку для рыбы «${moving}».`
    : pending ? 'Выбери место для улова. Рыбу в трюме можно передвинуть.'
      : run.cargo.length ? 'Выбери рыбу, чтобы передвинуть, повернуть или выпустить её.' : 'Трюм пока пуст.';
  const active = cargoDraft ?? pending;
  const footprint = active ? cargoCells(active, 0, 0) : [];
  const [footprintColumns] = active ? game.dimensions(active) : [0, 0];
  hold.innerHTML = `<header class="panel-head"><div><span class="eyebrow">Пауза · ${placements.size} / ${columns * rows} ячеек</span>
    <h2 id="hold-title">${pending ? 'Уложить улов' : 'Трюм'}</h2></div>
    ${pending ? '' : '<button data-action="hold" aria-label="Закрыть трюм">×</button>'}</header>
    ${kind && pending ? `<div class="pending" data-fish="${pending.id}" style="--fish:${kind.color}"><strong>${kind.name}</strong><span>${kind.tier} · ${cargoCells(pending).length} кл. · ${price(pending.id as FishId)} др.</span></div>` : ''}
    <div class="hold-placement"><p class="panel-text">${hint}</p>${active ? `<span class="cargo-footprint"
      style="--footprint-columns:${footprintColumns};--fish:${fish[active.id].color}" aria-hidden="true">${footprint.map(
        ({ x, y }) => `<i style="grid-area:${y + 1} / ${x + 1}"></i>`,
      ).join('')}</span>` : ''}</div>
    <div class="cargo-grid" style="--cols:${columns};--rows:${rows}">${cells}</div>
    ${fishButtons ? `<div class="cargo-actions" aria-label="Улов в трюме">${fishButtons}</div>` : ''}
    ${pending || cargoDraft ? `<div class="button-row"><button data-action="rotate">Повернуть <kbd>R</kbd></button>
      ${cargoDraft ? '<button data-action="cancel-cargo">Отменить перемещение</button><button data-action="release-old">Выпустить выбранную</button>'
        : '<button data-action="release">Выпустить рыбу</button>'}</div>` : ''}
    <p id="hold-note" role="status"></p>`;
  const buttons = [...hold.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const replacement = previous && buttons.find(button => button.dataset.action === previous.action
    && button.dataset.id === previous.id && button.dataset.x === previous.x && button.dataset.y === previous.y);
  if (replacement || previous || focus) (replacement || buttons[0])?.focus();
}

function highlightCell(cell: HTMLElement | null) {
  const item = cargoDraft ?? game.run?.pending;
  for (const previous of hold.querySelectorAll<HTMLElement>('[data-preview]')) delete previous.dataset.preview;
  if (!cell || !item) return;
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  const cells = cargoCells(item, x, y);
  const fit = game.fits(item, x, y, cargoDraft?.key);
  for (const button of hold.querySelectorAll<HTMLButtonElement>('.cell')) {
    const col = Number(button.dataset.x);
    const row = Number(button.dataset.y);
    if (cells.some(position => position.x === col && position.y === row)) {
      button.dataset.preview = fit ? 'fits' : 'blocked';
    }
  }
}

function selectCargo(key: number) {
  const item = game.run?.cargo.find(cargo => cargo.key === key);
  cargoDraft = item && key !== cargoDraft?.key ? { ...item } : null;
  renderHold(true);
}

function rotateHold() {
  if (cargoDraft) cargoDraft = rotateCargo(cargoDraft);
  else game.rotate();
  renderHold();
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
      case 'cargo':
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
      case 'injury':
      case 'artel-progress':
        save();
        break;
    }
  }
}

async function sail() {
  if (!scene || currentMenu !== 'map' || loadingLocation || !game.hull || !game.unlocked(selectedZone)) return;
  const request = new AbortController();
  const zone = selectedZone;
  loadingLocation = request;
  mapNotice = '';
  renderMenu();
  let unattached: LoadedLocation | undefined;
  let attached = false;
  try {
    if (game.meta.boat) {
      try {
        await scene.prepareSail();
      } catch (error) {
        if (request.signal.aborted) return;
        mapNotice = 'Парус не загрузился. Попробуй выйти на воду ещё раз.';
        console.warn('Sail model could not be loaded', error);
        return;
      }
      if (request.signal.aborted) return;
    }
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

function updatePolyphemus(now: number, cashOut = false) {
  const parlor = game.polyphemus;
  if (parlor.settle(now, cashOut)) {
    save();
    updateDock();
    if (currentMenu === 'polyphemus') renderMenu();
    return;
  }
  const quote = parlor.quote(now);
  if (quote) paintPolyphemus?.(quote);
}

function artelChange(message: string) {
  artelNotice = message;
  save();
  updateDock();
  renderMenu();
}

function action(button: HTMLButtonElement) {
  const { action, id } = button.dataset;
  if (water.contains(button)) zoneIntro.hidden = true;
  switch (action) {
    case 'water-settings':
      toggleWaterInspector();
      break;
    case 'shop':
    case 'poly-shop':
      artelNotice = '';
      shopSalesExpanded = false;
      showMenu('shop');
      break;
    case 'workshop':
    case 'tasks':
    case 'shrine':
    case 'observatory':
      artelNotice = '';
      showMenu(action);
      break;
    case 'polyphemus':
      if (!game.run && !game.result) showMenu('polyphemus');
      break;
    case 'poly-start': {
      if (currentMenu !== 'polyphemus' || game.run || game.result) break;
      const selection = byId<HTMLSelectElement>('poly-stake');
      const stake = game.polyphemus.inventory().find(item => stakeKey(item) === selection?.value);
      if (!stake || !game.polyphemus.start({ id: stake.id, condition: stake.condition }, performance.now())) break;
      selectedStake = stakeKey(stake);
      save();
      updateDock();
      renderMenu();
      break;
    }
    case 'poly-cashout':
      if (currentMenu === 'polyphemus') updatePolyphemus(performance.now(), true);
      break;
    case 'poly-again':
      game.polyphemus.outcome = null;
      renderMenu();
      byId('poly-stake')?.focus();
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
    case 'sell-one': {
      if (currentMenu !== 'shop' || game.polyphemus.round) break;
      const stake = action === 'sell-one' ? game.polyphemus.inventory().find(item => stakeKey(item) === id) : undefined;
      if (action === 'sell-one' && !stake) break;
      shopSalesExpanded = Boolean(menuContent.querySelector('.harbor-fish-sales[open]'));
      const before = game.meta.gold;
      const debt = game.meta.artel.repairDebt;
      if (stake) game.sellStake(stake);
      else game.sell();
      const paid = debt - game.meta.artel.repairDebt;
      artelChange(`За улов получено ${game.meta.gold - before} др.${paid ? ` В счёт ремонта удержано ${paid} др.` : ''}`);
      break;
    }
    case 'artel-build': {
      const building = currentMenu ? menuBuilding[currentMenu] : undefined;
      if (!building || building !== id) break;
      const level = game.meta.artel.buildings[building];
      if (level ? game.upgradeArtel(building) : game.buildArtel(building)) {
        artelChange(level ? 'Здание улучшено.' : 'Здание построено.');
      }
      break;
    }
    case 'artel-rod':
      if (currentMenu === 'shop' && game.buyRod()) artelChange('Новая удочка снаряжена.');
      break;
    case 'artel-repair':
      if (currentMenu === 'workshop' && game.repairHull()) artelChange('Корпус восстановлен.');
      break;
    case 'artel-hold':
      if (currentMenu === 'workshop' && game.expandHold()) artelChange('Трюм расширен.');
      break;
    case 'artel-research':
      if (currentMenu === 'observatory' && id === 'temple' && game.researchLocation(id)) {
        artelChange('Гавань затонувшего лика открыта на карте.');
      }
      break;
    case 'artel-claim': {
      const task = game.artelTasks.find(task => task.id === id);
      if (currentMenu === 'tasks' && task && game.claimTask(task.id)) artelChange('Награда получена.');
      break;
    }
    case 'primary':
      if (hold.hidden) game.primary();
      break;
    case 'dash':
      if (hold.hidden) game.dash();
      break;
    case 'mobile-cast': {
      if (!touchLayout.matches || game.run?.phase !== 'ready') break;
      const arm = !mobileCastArmed;
      if (game.aiming) toggleBow();
      clearInputs();
      mobileCastArmed = arm;
      break;
    }
    case 'mobile-bow':
      if (touchLayout.matches) toggleBow();
      break;
    case 'mobile-fish-action':
      if (touchLayout.matches && hold.hidden) game.primary();
      break;
    case 'return':
      if (game.atReturnPoint) game.finish();
      else if (game.run) game.tell('Подведи лодку к золотому кругу у причала.');
      break;
    case 'hold':
      toggleHold();
      break;
    case 'cell': {
      const { x, y, cargo } = button.dataset;
      if (cargoDraft) {
        const { key, rotation, turned } = cargoDraft;
        if (game.moveCargo(key, rotation ?? Number(turned), Number(x), Number(y))) cargoDraft = null;
        else byId('hold-note').textContent = 'Здесь рыба не поместится. Выбери другую ячейку.';
      } else if (game.run?.pending) {
        if (!game.pack(Number(x), Number(y))) {
          byId('hold-note').textContent = 'Рыба не помещается. Выбери другую ячейку, поверни или освободи место.';
        }
      } else if (cargo) {
        selectCargo(Number(cargo));
      }
      break;
    }
    case 'rotate':
      rotateHold();
      break;
    case 'select-cargo':
      selectCargo(Number(id));
      break;
    case 'cancel-cargo':
      cargoDraft = null;
      renderHold(true);
      break;
    case 'release':
      game.release(undefined);
      break;
    case 'release-old':
      if (cargoDraft) {
        const key = cargoDraft.key;
        cargoDraft = null;
        game.release(key);
      }
      break;
  }
  processEvents();
  renderWater();
}

document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (button && !button.disabled) action(button);
});

menuContent.addEventListener('change', event => {
  if (event.target instanceof HTMLSelectElement && event.target.id === 'poly-stake') {
    selectedStake = event.target.value;
    renderMenu();
    byId('poly-stake')?.focus();
  }
});

hold.addEventListener('pointerover', event => highlightCell((event.target as HTMLElement).closest('.cell')));
hold.addEventListener('pointerleave', () => highlightCell(null));
hold.addEventListener('focusin', event => highlightCell((event.target as HTMLElement).closest('.cell')));
hold.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'KeyR') {
    event.preventDefault();
    if (!event.repeat) rotateHold();
    return;
  }
  if (event.code === 'Escape') {
    event.preventDefault();
    if (cargoDraft) {
      cargoDraft = null;
      renderHold(true);
    } else {
      toggleHold();
      renderWater();
    }
    return;
  }
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
  for (const input of touchKeys.values()) game.inputs.add(input);
}

function holdFishingInput(button: HTMLElement, input: Input) {
  button.addEventListener('pointerdown', event => {
    const phase = game.run?.phase;
    if (!touchLayout.matches || event.button !== 0 || game.aiming || menu.open || !hold.hidden
      || phase !== (input === 'reel' ? 'reel' : 'struggle')) return;
    event.preventDefault();
    touchKeys.set(event.pointerId, input);
    syncKeys();
    button.setPointerCapture(event.pointerId);
  });
  for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    button.addEventListener(kind, event => {
      if (touchKeys.delete(event.pointerId)) syncKeys();
    });
  }
}
hud.mobileFish.addEventListener('pointerdown', event => {
  if (!touchLayout.matches || event.button !== 0 || game.run?.phase !== 'hook' || !hold.hidden || menu.open) return;
  event.preventDefault();
  action(hud.mobileFish);
});
holdFishingInput(hud.mobileFish, 'reel');
for (const direction of ['left', 'right'] as const) {
  holdFishingInput(hud.mobileSteer.querySelector<HTMLElement>(`[data-mobile-control="${direction}"]`)!, direction);
}

document.addEventListener('keydown', event => {
  if (currentMenu === 'polyphemus' && game.polyphemus.round && event.code === 'Space'
    && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    if (!event.repeat) updatePolyphemus(performance.now(), true);
    return;
  }
  if (event.target instanceof Node && waterInspector.contains(event.target)) {
    if (event.code === 'Escape') toggleWaterInspector();
    return;
  }
  const run = game.run;
  if (!run || menu.open || event.defaultPrevented || !hold.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'Tab' && !event.shiftKey) {
    if (!event.repeat && toggleHold()) {
      event.preventDefault();
      renderWater();
    }
    return;
  }
  const focusedButton = event.target instanceof HTMLButtonElement ? event.target : null;
  if (event.code === 'Space' && focusedButton && (hold.contains(focusedButton)
    || focusedButton.dataset.action === 'primary' || (run.phase === 'ready' && focusedButton.matches(':focus-visible')))) return;
  const input = inputKeys[event.code];
  const helm = helmKeys[event.code];
  const escape = event.code === 'Escape';
  if (!input && !helm && !escape) return;
  zoneIntro.hidden = true;
  event.preventDefault();
  if (event.repeat) return;

  if (helm && hold.hidden && (run.phase === 'ready' || game.aiming)) game.helm.add(helm);
  if (input && !game.aiming && ['struggle', 'reel'].includes(run.phase)) {
    keys.set(event.code, input);
    syncKeys();
  } else if (input === 'reel') {
    if (run.phase === 'ready') game.dash();
    else game.primary();
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
  if ((event.button !== 0 && event.button !== 2) || !scene || menu.open || !hold.hidden || drawPointer !== null
    || !waterInspector.hidden) return;
  if (touchLayout.matches) {
    if (event.button !== 0 || !event.isPrimary || !waterInspector.hidden || !game.run || (!game.aiming && game.run.phase !== 'ready')) return;
    event.preventDefault();
    waterTap = { id: event.pointerId, x: event.clientX, y: event.clientY };
    sceneHost.setPointerCapture(event.pointerId);
    return;
  }
  if (!(event.button === 2 ? game.beginBow() : game.beginCast())) {
    if (event.button === 2 && game.run) event.preventDefault();
    return;
  }
  event.preventDefault();
  zoneIntro.hidden = true;
  water.focus({ preventScroll: true });
  drawPointer = event.pointerId;
  pointer = event;
  game.target = scene.pointAt(event.clientX, event.clientY, game.aiming);
  sceneHost.setPointerCapture(event.pointerId);
});
sceneHost.addEventListener('pointermove', event => {
  if (touchLayout.matches) {
    if (waterTap?.id === event.pointerId && Math.hypot(event.clientX - waterTap.x, event.clientY - waterTap.y) > 16) waterTap = null;
    return;
  }
  if ((!game.aiming && !game.drawing) || (drawPointer !== null && event.pointerId !== drawPointer)) return;
  pointer = event;
  game.target = scene?.pointAt(event.clientX, event.clientY, game.aiming) ?? null;
});
sceneHost.addEventListener('pointerup', event => {
  if (touchLayout.matches) {
    if (waterTap?.id !== event.pointerId) return;
    const tap = waterTap;
    waterTap = null;
    if (!game.run || menu.open || !hold.hidden || !waterInspector.hidden || !scene
      || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 16) return;
    const target = scene.pointAt(event.clientX, event.clientY, game.aiming);
    if (!target) return;
    zoneIntro.hidden = true;
    if (game.aiming) {
      if (game.shootAt(target)) toggleBow();
    } else if (mobileCastArmed) {
      if (game.castAt(target)) {
        hasCast = true;
        mobileCastArmed = false;
      }
    } else {
      game.setMoveTarget(target);
    }
    processEvents();
    renderWater();
    return;
  }
  if (drawPointer !== event.pointerId) return;
  drawPointer = null;
  game.target = scene?.pointAt(event.clientX, event.clientY, game.aiming) ?? null;
  if (game.aiming) {
    game.releaseArrow();
    game.toggleBow();
  } else {
    hasCast = true;
    game.releaseCast();
  }
  processEvents();
  renderWater();
});
for (const kind of ['pointercancel', 'lostpointercapture'] as const) {
  sceneHost.addEventListener(kind, event => {
    if (waterTap?.id === event.pointerId) waterTap = null;
    if (event.pointerId !== drawPointer) return;
    drawPointer = null;
    game.abortDraw();
    if (game.aiming) game.toggleBow();
  });
}
sceneHost.addEventListener('contextmenu', event => {
  if (game.run) event.preventDefault();
});
sceneHost.addEventListener('wheel', event => {
  if (!event.deltaY || !game.run || game.firstPerson || !hold.hidden || menu.open || !waterInspector.hidden) return;
  event.preventDefault();
  scene?.zoomBy(Math.sign(event.deltaY));
}, { passive: false });
touchLayout.addEventListener('change', () => {
  updateTouchLayout();
  clearInputs();
  renderWater();
});
window.addEventListener('blur', clearInputs);
document.addEventListener('visibilitychange', () => {
  clearInputs();
  if (game.polyphemus.round) updatePolyphemus(performance.now());
});

let previousFrame = performance.now();
function frame(now: number) {
  const dt = Math.min((now - previousFrame) / 1000, .05);
  previousFrame = now;
  let boatSpeed = 0;
  if (game.run && !menu.open && !document.hidden) {
    if ((game.aiming || game.drawing) && pointer) game.target = scene?.pointAt(pointer.clientX, pointer.clientY, game.aiming) ?? null;
    const run = game.run;
    const { x, z } = game.position;
    if (hold.hidden) game.step(dt);
    if (dt > 0 && game.run === run) {
      boatSpeed = Math.hypot(game.position.x - x, game.position.z - z) / dt;
    }
    processEvents();
    renderWater();
  }
  if (game.polyphemus.round) updatePolyphemus(now);
  scene?.update(dt, boatSpeed);
  requestAnimationFrame(frame);
}

if (game.recoveredStake) save();
showDock();
requestAnimationFrame(frame);
