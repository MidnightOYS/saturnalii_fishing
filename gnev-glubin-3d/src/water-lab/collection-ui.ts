/// <reference types="vite/client" />

import labStyle from './ui.css?inline';
import collectionStyle from './collection-ui.css?inline';
import gameStyle from './collection-game.css?inline';
import {
  collectionPresets, colorNames, defaultCollection, definitions, effectNames, modeGroups, rangesFor,
  readCollection, switchesFor, wrathControl, type CollectionSnapshot, type LabSettings, type Mode, type Range,
} from './collection-settings';
export type { LabSettings, Mode } from './collection-settings';

type Actions = { pause: () => boolean; reset: () => void; cast: () => void; angle: (degrees: number) => void };
type Options = { root?: HTMLElement; initial?: CollectionSnapshot; game?: boolean };

const numberFormat = new Intl.NumberFormat('ru', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function rangeControl(label: string, min: number, max: number, step: number, initial: number,
  format: (value: number) => string, change: (value: number) => void, name: string) {
  const field = element('label', 'lab-slider');
  const caption = element('span', '', label);
  const value = element('output');
  const input = element('input');
  input.setAttribute('aria-label', label);
  input.type = 'range';
  input.id = 'lab-' + name;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  value.htmlFor.add(input.id);
  function sync(n: number) {
    input.value = String(n);
    input.style.setProperty('--range', (n - min) / (max - min) * 100 + '%');
    value.value = format(n);
  }
  sync(initial);
  input.oninput = () => { sync(input.valueAsNumber); change(input.valueAsNumber); };
  field.append(caption, value, input);
  return { field, sync };
}

function checkbox(label: string, initial: boolean, change: (checked: boolean) => void) {
  const field = element('label', 'lab-auto');
  const input = element('input');
  input.type = 'checkbox';
  input.checked = initial;
  input.onchange = () => change(input.checked);
  field.append(input, document.createTextNode(label));
  return field;
}

export function makeLabUI(onChange: (mode: Mode, settings: LabSettings, snapshot: CollectionSnapshot) => void,
  actions?: Actions, { root: mount, initial, game = false }: Options = {}) {
  let root = mount ?? document.querySelector<HTMLElement>('#lab-ui')!;
  if (game) {
    const shadow = root.attachShadow({ mode: 'open' });
    const style = element('style');
    style.textContent = labStyle.replace(':root', ':host') + collectionStyle + gameStyle;
    root = element('div', 'game-water-collection');
    shadow.append(style, root);
  }
  let snapshot = initial ?? defaultCollection(game);
  root.classList.add('lab-collection');
  root.innerHTML = `
    <header class="lab-heading">
      <p>Гнев глубин</p><h1>Все воды</h1>
      <nav class="lab-collection-nav" aria-label="Режимы воды"></nav>
    </header>
    <details class="lab-inspector">
      <summary><span>Инспектор</span><span class="inspector-chevron" aria-hidden="true">⌄</span></summary>
      <div class="lab-panel">
        <div class="lab-tech"><h2></h2><p></p></div>
        <fieldset class="lab-preset-group"><legend>Пресеты</legend><div class="lab-presets"></div></fieldset>
        <div class="lab-controls"></div>
        <div class="lab-colors"></div>
        <details class="lab-extra"><summary>Дополнительные настройки</summary><div class="lab-extra-controls"></div></details>
        <div class="lab-session-controls"><label class="lab-auto"><input type="checkbox"> Автогнев</label></div>
        <div class="lab-transfer">
          <button type="button" class="lab-import">Импорт JSON</button>
          <button type="button" class="lab-export">Экспорт JSON</button>
          <input type="file" accept=".json,application/json" class="lab-file" hidden>
          <output class="lab-transfer-status" role="status"></output>
        </div>
      </div>
    </details>
    <section class="lab-actions" aria-label="Управление сценой">
      <output class="lab-status" role="status"></output>
      <div class="lab-action-row"><button type="button" class="lab-cast">Забросить</button>
      <button type="button" class="lab-pause" aria-pressed="false">Пауза</button>
      <button type="button" class="lab-reset">Вернуть лодку</button></div>
      <div class="lab-keys"><kbd>WASD</kbd> лодка <span>·</span> <kbd>Пробел</kbd> заброс</div>
    </section>`;

  const find = <T extends HTMLElement = HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  find<HTMLDetailsElement>('.lab-inspector').open = game || !matchMedia('(max-width: 720px), (max-height: 515px)').matches;
  const nav = find('.lab-collection-nav');
  const controls = find('.lab-controls');
  const presets = find('.lab-presets');
  const colors = find('.lab-colors');
  const extra = find<HTMLDetailsElement>('.lab-extra');
  const extraControls = find('.lab-extra-controls');
  const autoWrath = find<HTMLInputElement>('.lab-auto input');
  const status = find<HTMLOutputElement>('.lab-status');
  const transfer = find<HTMLOutputElement>('.lab-transfer-status');
  const pause = find<HTMLButtonElement>('.lab-pause');
  const file = find<HTMLInputElement>('.lab-file');

  const current = () => snapshot.modes[snapshot.mode];
  const notify = () => onChange(snapshot.mode, { ...current() }, snapshot);
  function setMode(mode: Mode) {
    if (snapshot.mode === mode) return;
    snapshot.mode = mode;
    extra.open = false;
    redraw();
    notify();
  }
  for (const group of modeGroups) {
    const row = element('div', 'lab-mode-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', group.label);
    row.append(element('span', 'lab-mode-label', group.label));
    const buttons = element('div', 'lab-nav');
    for (const mode of group.modes) {
      const button = element('button', '', definitions[mode].tab);
      button.type = 'button';
      button.dataset.mode = mode;
      button.onclick = () => setMode(mode);
      buttons.append(button);
    }
    row.append(buttons);
    nav.append(row);
  }

  const camera = rangeControl('Угол камеры', 24, 48, 1, snapshot.cameraElevation, n => n + '°', n => {
    snapshot.cameraElevation = n;
    actions?.angle(n);
    refreshPresets();
  }, 'angle');
  const wrath = range(wrathControl);
  wrath.field.classList.add('lab-wrath');
  autoWrath.onchange = () => { snapshot.autoWrath = autoWrath.checked; };
  autoWrath.parentElement!.before(wrath.field);
  autoWrath.parentElement!.after(camera.field);

  function formatWrath(value: number) { return Math.round(value * 100) + '%'; }
  function range([key, label, min, max]: Range) {
    const step = key === 'renderScale' ? .05 : .01;
    const format = key === 'wrath' ? formatWrath : (value: number) => numberFormat.format(value);
    return rangeControl(label, min, max, step, current()[key] ?? min, format, value => {
      current()[key] = value;
      if (key === 'wrath') {
        snapshot.autoWrath = autoWrath.checked = false;
      }
      refreshPresets();
      notify();
    }, key);
  }

  function setPaused(paused: boolean) {
    if (snapshot.paused !== paused) actions?.pause();
    snapshot.paused = paused;
    pause.textContent = paused ? 'Продолжить' : 'Пауза';
    pause.setAttribute('aria-pressed', String(paused));
  }
  function refreshPresets() {
    const settings = current();
    const items = collectionPresets(snapshot.mode, game);
    const active = items.findIndex(preset => (preset.cameraElevation === undefined || preset.cameraElevation === snapshot.cameraElevation)
      && Object.entries(preset.settings).every(([key, value]) => {
        const selected = settings[key as keyof LabSettings];
        return key === 'effects' ? JSON.stringify(selected) === JSON.stringify(value) : selected === value;
      }));
    Array.from(presets.children).forEach((node, i) => node.setAttribute('aria-pressed', String(i === active)));
  }

  function redraw() {
    const def = definitions[snapshot.mode];
    root.dataset.mode = snapshot.mode;
    find('.lab-tech h2').textContent = def.title;
    find('.lab-tech p').textContent = def.summary;
    nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === snapshot.mode)));
    presets.replaceChildren(...collectionPresets(snapshot.mode, game).map(preset => {
      const button = element('button', '', preset.name);
      button.type = 'button';
      button.onclick = () => {
        snapshot.modes[snapshot.mode] = { ...preset.settings, ...(preset.settings.effects && { effects: { ...preset.settings.effects } }) };
        if (preset.cameraElevation !== undefined) {
          snapshot.cameraElevation = preset.cameraElevation;
          camera.sync(snapshot.cameraElevation);
          actions?.angle(snapshot.cameraElevation);
        }
        redraw();
        notify();
        Array.from(presets.querySelectorAll('button')).find(item => item.textContent === preset.name)?.focus();
      };
      return button;
    }));
    refreshPresets();
    controls.replaceChildren(...rangesFor(snapshot.mode).map(config => range(config).field));
    colors.replaceChildren(...(def.colors ?? ['shallow', 'deep'] as const).map(key => {
      const label = element('label');
      const input = element('input');
      input.type = 'color';
      input.value = current()[key] ?? '#000000';
      input.oninput = () => {
        current()[key] = input.value;
        refreshPresets();
        notify();
      };
      label.append(input, document.createTextNode(colorNames[key]));
      return label;
    }));
    const settings = current();
    const advanced: HTMLElement[] = (def.extras ?? [])
      .filter(([key]) => !game || key !== 'wrathRate')
      .map(config => range(config).field);
    for (const [key, label] of switchesFor(snapshot.mode)) advanced.push(checkbox(label, settings[key] ?? true, checked => {
      current()[key] = checked;
      refreshPresets();
      notify();
    }));
    if (settings.reflectionQuality) {
      const field = element('label', 'lab-quality', 'Качество отражений');
      const select = element('select');
      for (const [key, label] of [['off', 'Выключено'], ['balanced', 'Обычное'], ['full', 'Полное']]) {
        const option = element('option', '', label);
        option.value = key;
        select.append(option);
      }
      select.value = settings.reflectionQuality;
      select.onchange = () => {
        current().reflectionQuality = select.value as LabSettings['reflectionQuality'];
        refreshPresets();
        notify();
      };
      field.append(select);
      advanced.push(field);
    }
    const effects = settings.effects;
    if (effects) {
      const group = element('fieldset', 'lab-effects');
      group.append(element('legend', '', 'Эффекты'));
      for (const key of Object.keys(effectNames) as (keyof typeof effectNames)[]) {
        group.append(checkbox(effectNames[key], effects[key], checked => {
          current().effects = { ...current().effects!, [key]: checked };
          refreshPresets();
          notify();
        }));
      }
      advanced.push(group);
    }
    extra.hidden = advanced.length === 0;
    extraControls.replaceChildren(...advanced);
    wrath.sync(settings.wrath);
  }

  let previous = performance.now();
  if (!game) window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(.5, (now - previous) / 1000);
    previous = now;
    if (snapshot.paused || !snapshot.autoWrath || document.hidden || current().wrath >= 1) return;
    current().wrath = Math.min(1, current().wrath + dt * (current().wrathRate ?? 1.2) * .01);
    wrath.sync(current().wrath);
    refreshPresets();
    notify();
  }, 220);

  if (game) {
    find('.lab-panel').prepend(nav);
    find('.lab-heading').remove();
    find('.lab-inspector > summary').remove();
    find('.lab-session-controls').remove();
    find('.lab-actions').remove();
  } else {
    find<HTMLButtonElement>('.lab-cast').onclick = actions?.cast ?? null;
    find<HTMLButtonElement>('.lab-reset').onclick = actions?.reset ?? null;
    pause.onclick = () => setPaused(!snapshot.paused);
  }
  find<HTMLButtonElement>('.lab-export').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const link = element('a');
    link.href = url;
    link.download = 'gnev-glubin-water-collection-' + snapshot.mode + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    transfer.value = 'Настройки готовы к передаче';
  };
  find<HTMLButtonElement>('.lab-import').onclick = () => file.click();
  file.onchange = async () => {
    const selection = file.files?.[0];
    file.value = '';
    if (!selection) return;
    try {
      if (selection.size > 1024 * 1024) throw new Error('Файл настроек больше 1 МБ.');
      let data: unknown;
      try { data = JSON.parse(await selection.text()); }
      catch { throw new Error('Файл не удалось прочитать как JSON.'); }
      const imported = readCollection(data, snapshot);
      setPaused(imported.paused);
      snapshot = imported;
      autoWrath.checked = snapshot.autoWrath;
      camera.sync(snapshot.cameraElevation);
      actions?.angle(snapshot.cameraElevation);
      redraw();
      notify();
      transfer.value = 'Настройки загружены';
    } catch (error) {
      transfer.value = error instanceof Error ? error.message : 'Не удалось загрузить настройки.';
    }
  };
  autoWrath.checked = snapshot.autoWrath;
  redraw();
  notify();
  return {
    getSnapshot: () => snapshot,
    setStatus(message: string) {
      if (status.value !== message) status.value = message;
    },
  };
}
