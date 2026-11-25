import './ui.css';
import './layers-ui.css';

export type Mode = 'refraction' | 'meadow' | 'wreck' | 'night';
export type LabSettings = {
  wrath: number;
  waves: number;
  light: number;
  feature: number;
  detail: number;
  layer: number;
  wind: number;
  deep: string;
  shallow: string;
};

type Preset = { name: string; settings: LabSettings; cameraElevation?: number };
type SliderKey = Exclude<keyof LabSettings, 'deep' | 'shallow'>;
type Definition = {
  tab: string; title: string; summary: string; layer: string;
  presets: Preset[];
};

function preset(name: string, deep: string, shallow: string, values: Partial<LabSettings>): Preset {
  return { name, settings: { wrath: .05, waves: .8, light: 1, feature: 1, detail: 1, wind: .85, layer: 1, deep, shallow, ...values } };
}

const modes: Record<Mode, Definition> = {
  refraction: {
    tab: 'Исходный', title: 'Мраморное дно',
    summary: 'Свет проходит через зыбь и скользит по древней мозаике.',
    layer: 'Плотность воды',
    presets: [
      preset('Мрамор', '#185967', '#83d5b3', { feature: 1.3, detail: 1, light: 1.1, waves: .68 }),
      preset('Олива', '#254638', '#a3ad67', { feature: .78, detail: 1.5, light: .9, wind: .55, waves: .48 }),
      preset('Бирюза', '#0a4755', '#49d4ba', { feature: 1.65, detail: 1.35, light: 1.2, waves: 1.1, wind: 1.3, wrath: .18 }),
      { ...preset('Шторм из видео', '#185967', '#83d5b3', { feature: 1.30, detail: .30, waves: .94, wind: 1.85, light: 1.10, wrath: 1 }), cameraElevation: 34 },
    ],
  },
  meadow: {
    tab: 'Посидония', title: 'Луга посидонии',
    summary: 'Солнечные полосы пересекают листья и светлые просветы песка.',
    layer: 'Подводный свет',
    presets: [
      preset('Отмель', '#175859', '#9bcca1', { waves: .67, wind: .61, light: 1.13, layer: 1.05, detail: .92, feature: 1.20 }),
      preset('Полдень', '#13495b', '#56ccbb', { waves: .81, wind: 1.09, light: 1.36, layer: 1.50, detail: 1.08, feature: 1.40 }),
      preset('Оливковый', '#263e34', '#b6ba71', { waves: .47, wind: .45, light: .94, layer: .72, detail: .75, feature: .76 }),
    ],
  },
  wreck: {
    tab: 'Остов', title: 'Затонувший груз',
    summary: 'Рыбы проходят между лодкой и обломками корпуса, над амфорами висит взвесь.',
    layer: 'Взвесь над дном',
    presets: [
      preset('Амфоры', '#173f48', '#a7bfa1', { waves: .74, wind: .78, layer: .76, light: 1.02, detail: .93, feature: 1.03 }),
      preset('Течение', '#124555', '#62c1ba', { waves: 1.14, wind: 1.28, layer: .44, light: 1.16, detail: 1.16, feature: 1.34, wrath: .17 }),
      preset('Ил', '#344a42', '#c3ad7c', { waves: .65, wind: .53, layer: 1.55, light: .9, detail: .88, feature: .68 }),
    ],
  },
  night: {
    tab: 'Медузы', title: 'Ночная бухта',
    summary: 'Под тёмной поверхностью видны светящиеся колонии и дрейфующие медузы.',
    layer: 'Свечение планктона',
    presets: [
      preset('Полночь', '#10233e', '#287884', { layer: 1.26, waves: .66, wind: .65, feature: .67, detail: 1.03, light: .63 }),
      preset('Фосфор', '#0d3034', '#378d79', { layer: 1.80, waves: .81, wind: .94, feature: .55, detail: 1.12, light: .48 }),
      preset('Луна', '#252c51', '#79acbf', { layer: .84, waves: .48, wind: .52, feature: .95, detail: .80, light: 1.01 }),
    ],
  },
};

const modeKeys: Mode[] = ['refraction', 'meadow', 'wreck', 'night'];
const keys: SliderKey[] = ['layer', 'feature', 'detail', 'waves', 'wind', 'light', 'wrath'];
const fixedNames = { detail:'Преломление', feature: 'Каустика', wind: 'Ветер', waves: 'Высота волн', light: 'Свет', wrath: 'Гнев' };
const numberFormat = new Intl.NumberFormat('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function makeLabUI(
  onChange: (mode: Mode, settings: LabSettings) => void,
  actions: { pause: () => boolean; reset: () => void; cast: () => void; angle?: (degrees: number) => void },
) {
  const root = document.querySelector<HTMLElement>('#lab-ui')!;
  const states = Object.fromEntries(modeKeys.map(key => [key, { ...modes[key].presets[0].settings }])) as Record<Mode, LabSettings>;
  const selection: Record<Mode, number | null> = { refraction: 0, meadow: 0, wreck: 0, night: 0 };
  let mode: Mode = 'refraction';
  let paused = false;

  root.innerHTML = `
    <header class="lab-heading">
      <p>Гнев глубин</p><h1>Под водой</h1>
      <nav class="lab-nav" aria-label="Подводный пейзаж"></nav>
    </header>
    <details class="lab-inspector">
      <summary><span>Инспектор</span><span class="inspector-chevron" aria-hidden="true">⌄</span></summary>
      <div class="lab-panel">
        <div class="lab-tech"><h2></h2><p></p></div>
        <fieldset class="lab-preset-group"><legend>Пресеты</legend><div class="lab-presets"></div></fieldset>
        <div class="lab-controls"></div>
        <label class="lab-auto"><input type="checkbox"> Автогнев</label>
        <div class="lab-colors"></div>
        <label class="lab-slider lab-angle" for="lab-angle"><span>Угол камеры</span><output for="lab-angle">32°</output>
          <input id="lab-angle" type="range" min="24" max="48" step="1" value="32"></label>
        <button type="button" class="lab-export">Экспорт JSON <span aria-hidden="true">↓</span></button>
      </div>
    </details>
    <section class="lab-actions" aria-label="Управление сценой">
      <output class="lab-status" role="status"></output>
      <div class="lab-action-row"><button type="button" class="lab-cast">Забросить</button>
      <button type="button" class="lab-pause" aria-pressed="false">Пауза</button>
      <button type="button" class="lab-reset">Вернуть лодку</button></div>
      <div class="lab-keys"><kbd>WASD</kbd> лодка <span>·</span> <kbd>Пробел</kbd> заброс</div>
    </section>`;

  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const inspector = find<HTMLDetailsElement>('.lab-inspector');
  inspector.open = !matchMedia('(max-width: 720px), (max-height: 515px)').matches;
  const nav = find('.lab-nav');
  const presets = find('.lab-presets');
  const controls = find('.lab-controls');
  const colors = find('.lab-colors');
  const autoWrath = find<HTMLInputElement>('.lab-auto input');
  const heading = find('.lab-tech h2');
  const summary = find('.lab-tech p');
  const status = find<HTMLOutputElement>('.lab-status');
  const pauseButton = find<HTMLButtonElement>('.lab-pause');
  const angleInput = find<HTMLInputElement>('#lab-angle');
  const angleValue = find<HTMLOutputElement>('.lab-angle output');
  angleInput.style.setProperty('--range', '33.33%');
  function updateAngle() {
    angleValue.value = angleInput.value + '°';
    angleInput.style.setProperty('--range', (angleInput.valueAsNumber - 24) / 24 * 100 + '%');
    actions.angle?.(angleInput.valueAsNumber);
  }
  angleInput.oninput = updateAngle;

  function notify() { onChange(mode, { ...states[mode] }); }

  function markPreset(index: number | null) {
    selection[mode] = index;
    Array.from(presets.children).forEach((el, i) => el.setAttribute('aria-pressed', String(i === index)));
  }

  const refreshSliders: Partial<Record<SliderKey, () => void>> = {};
  const refreshColors: (() => void)[] = [];
  keys.forEach(key => {
    const label = document.createElement('label');
    const text = document.createElement('span');
    const input = document.createElement('input');
    const output = document.createElement('output');
    label.className = 'lab-slider' + (key === 'wrath' ? ' lab-wrath' : '');
    label.htmlFor = input.id = 'lab-' + key;
    output.htmlFor.add(input.id);
    input.type = 'range';
    input.min = '0';
    input.max = key === 'wrath' ? '1' : '2';
    input.step = '.01';
    input.addEventListener('input', () => {
      states[mode][key] = input.valueAsNumber;
      if (key === 'wrath') autoWrath.checked = false;
      markPreset(null);
      refreshSliders[key]!();
      notify();
    });
    refreshSliders[key] = () => {
      const value = states[mode][key];
      text.textContent = key === 'layer' ? modes[mode].layer : fixedNames[key];
      input.value = String(value);
      input.style.setProperty('--range', value / Number(input.max) * 100 + '%');
      output.value = key === 'wrath' ? Math.round(value * 100) + '%' : numberFormat.format(value);
    };
    label.append(text, output, input);
    controls.append(label);
  });

  for (const key of ['shallow', 'deep'] as const) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const title = document.createElement('span');
    title.textContent = key === 'shallow' ? 'Мелководье' : 'Глубина';
    input.type = 'color';
    input.id = 'lab-' + key;
    label.htmlFor = input.id;
    input.addEventListener('input', () => {
      states[mode][key] = input.value;
      markPreset(null);
      notify();
    });
    refreshColors.push(() => { input.value = states[mode][key]; });
    label.append(input, title);
    colors.append(label);
  }

  function redraw() {
    const def = modes[mode];
    root.dataset.layerMode = mode;
    heading.textContent = def.title;
    summary.textContent = def.summary;
    nav.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
    presets.replaceChildren(...def.presets.map((p, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = p.name;
      button.setAttribute('aria-pressed', String(selection[mode] === i));
      button.onclick = () => {
        states[mode] = { ...p.settings };
        if (p.cameraElevation !== undefined) {
          angleInput.valueAsNumber = p.cameraElevation;
          updateAngle();
        }
        markPreset(i);
        Object.values(refreshSliders).forEach(refresh => refresh());
        refreshColors.forEach(refresh => refresh());
        notify();
      };
      return button;
    }));
    Object.values(refreshSliders).forEach(refresh => refresh());
    refreshColors.forEach(refresh => refresh());
  }

  modeKeys.forEach((key, index) => {
    const button = document.createElement('button');
    const letter = document.createElement('span');
    button.type = 'button';
    button.dataset.mode = key;
    letter.textContent = ['A', 'B', 'C', 'D'][index];
    button.append(letter, modes[key].tab);
    button.onclick = () => {
      if (mode === key) return;
      mode = key;
      redraw();
      notify();
    };
    nav.append(button);
  });

  // Use elapsed foreground time so switching tabs never jumps to full wrath.
  let previous = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(.5, (now - previous) / 1000);
    previous = now;
    if (paused || !autoWrath.checked || document.hidden || states[mode].wrath >= 1) return;
    states[mode].wrath = Math.min(1, states[mode].wrath + dt * .012);
    markPreset(null);
    refreshSliders.wrath!();
    notify();
  }, 220);

  find<HTMLButtonElement>('.lab-cast').onclick = actions.cast;
  find<HTMLButtonElement>('.lab-reset').onclick = actions.reset;
  pauseButton.onclick = () => {
    paused = actions.pause();
    pauseButton.textContent = paused ? 'Продолжить' : 'Пауза';
    pauseButton.setAttribute('aria-pressed', String(paused));
  };
  find<HTMLButtonElement>('.lab-export').onclick = () => {
    const settings = JSON.stringify({
      version: 1, demo: 'gnev-glubin-water-layers', autoWrath: autoWrath.checked, paused, mode, preset: modes[mode].presets[selection[mode] ?? -1]?.name ?? null,
      settings: states[mode], modes: states, cameraElevation: angleInput.valueAsNumber,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([settings], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gnev-glubin-water-layers-' + mode + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  redraw();
  notify();
  return {
    setStatus(message: string) {
      if (status.textContent !== message) status.textContent = message;
    },
  };
}
