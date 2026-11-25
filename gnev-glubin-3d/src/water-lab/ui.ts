import './ui.css';

export type Mode = 'refraction' | 'slopes' | 'breakers';
export type LabSettings = {
  wrath: number;
  waves: number;
  light: number;
  feature: number;
  detail: number;
  wind: number;
  deep: string;
  shallow: string;
};

type Preset = { name: string; settings: LabSettings };
type SliderKey = Exclude<keyof LabSettings, 'deep' | 'shallow'>;
type Definition = {
  tab: string; title: string; summary: string; feature: string; detail: string; wind: string;
  presets: Preset[];
};

function preset(name: string, deep: string, shallow: string, values: Partial<LabSettings>): Preset {
  return { name, settings: { wrath: .05, waves: .8, light: 1, feature: 1, detail: 1, wind: .85, deep, shallow, ...values } };
}

const modes: Record<Mode, Definition> = {
  refraction: {
    tab: 'Преломление', title: 'Свет на дне', summary: 'Преломление лучей и каустика на подводных поверхностях.',
    feature: 'Каустика', detail: 'Преломление', wind: 'Ветер',
    presets: [
      preset('Мрамор', '#185967', '#83d5b3', { feature: 1.3, detail: 1, light: 1.1, waves: .68 }),
      preset('Олива', '#254638', '#a3ad67', { feature: .78, detail: 1.5, light: .9, wind: .55, waves: .48 }),
      preset('Бирюза', '#0a4755', '#49d4ba', { feature: 1.65, detail: 1.35, light: 1.2, waves: 1.1, wind: 1.3, wrath: .18 }),
    ],
  },
  slopes: {
    tab: 'Блики', title: 'Свет на волнах', summary: 'Отдельные искры и широкая дорожка света на мелкой ряби.',
    feature: 'Направленность блика', detail: 'Мелкая рябь', wind: 'Ветер',
    presets: [
      preset('Серебро', '#193f56', '#70aeb3', { feature: 1.15, detail: 1.1, light: 1.2, waves: .86 }),
      preset('Стекло', '#173e48', '#78b5a9', { feature: .5, detail: .32, light: .96, wind: .26, waves: .39 }),
      preset('Шквал', '#152f48', '#547d91', { feature: 1.82, detail: 1.75, light: 1.34, wind: 1.8, waves: 1.27, wrath: .73 }),
    ],
  },
  breakers: {
    tab: 'Прибой', title: 'Объёмный прибой', summary: 'Заворот гребня, полость под волной и обрушение у скал.',
    feature: 'Сила обрушения', detail: 'Пена и брызги', wind: 'Темп наката',
    presets: [
      preset('Накат', '#124956', '#69bfae', { feature: 1.3, detail: 1.1, light: 1.07, wind: 1, waves: .9, wrath: .15 }),
      preset('Отлив', '#225665', '#a4bf92', { feature: .65, detail: .55, light: 1.12, wind: .5, waves: .55 }),
      preset('Шторм', '#173647', '#759d9b', { feature: 1.83, detail: 1.78, light: .94, wind: 1.62, waves: 1.32, wrath: .82 }),
    ],
  },
};

const modeKeys: Mode[] = ['refraction', 'slopes', 'breakers'];
const keys: SliderKey[] = ['feature', 'detail', 'waves', 'wind', 'light', 'wrath'];
const fixedNames = { waves: 'Высота волн', light: 'Свет', wrath: 'Гнев' };
const numberFormat = new Intl.NumberFormat('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function makeLabUI(
  onChange: (mode: Mode, settings: LabSettings) => void,
  actions: { pause: () => boolean; reset: () => void; cast: () => void; angle?: (degrees: number) => void },
) {
  const root = document.querySelector<HTMLElement>('#lab-ui')!;
  const states = Object.fromEntries(modeKeys.map(key => [key, { ...modes[key].presets[0].settings }])) as Record<Mode, LabSettings>;
  const selection: Record<Mode, number | null> = { refraction: 0, slopes: 0, breakers: 0 };
  let mode: Mode = 'refraction';
  let paused = false;

  root.innerHTML = `
    <header class="lab-heading">
      <p>Гнев глубин</p><h1>Атлас воды</h1>
      <nav class="lab-nav" aria-label="Технология воды"></nav>
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
  angleInput.oninput = () => {
    angleValue.value = angleInput.value + '°';
    angleInput.style.setProperty('--range', (angleInput.valueAsNumber - 24) / 24 * 100 + '%');
    actions.angle?.(angleInput.valueAsNumber);
  };

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
      text.textContent = key === 'feature' || key === 'detail' || key === 'wind' ? modes[mode][key] : fixedNames[key];
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
    letter.textContent = ['A', 'B', 'C'][index];
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
      version: 1, mode, preset: modes[mode].presets[selection[mode] ?? -1]?.name ?? null,
      settings: states[mode], modes: states, cameraElevation: angleInput.valueAsNumber,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([settings], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gnev-glubin-water-lab-' + mode + '.json';
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
