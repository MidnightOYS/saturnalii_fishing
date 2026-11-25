import { defaultVisualTuning, readVisualTuning, type VisualTuning } from './visual-tuning';

const saveKey = 'gnev-glubin-3d.visual.v1';
const tabs = ['Вода', 'Свет и туман', 'Эффекты'] as const;
type Gain = Exclude<keyof VisualTuning, 'stage' | 'skyTint'>;

type Field = { key: Gain; label: string; hint: string };
const atmosphere: Field[] = [
  { key: 'sun', label: 'Боковой свет', hint: 'Сила света на камне и настиле' },
  { key: 'fill', label: 'Заполнение теней', hint: 'Рассеянный свет с неба и от земли' },
  { key: 'fog', label: 'Плотность тумана', hint: 'Дымка на берегах и дальнем плане' },
  { key: 'skyGlow', label: 'Свечение горизонта', hint: 'Локальный свет неба в первом лице' },
  { key: 'skyTintMix', label: 'Влияние оттенка', hint: 'Насколько выбранный цвет меняет небо и дымку' }
];
const effects: Field[] = [
  { key: 'waterGrade', label: 'Палитра локации', hint: 'Влияние стадии гнева на цвет и блики воды' },
  { key: 'caustics', label: 'Каустика на отмели', hint: 'Световые линии на мелководье' },
  { key: 'foam', label: 'Пена', hint: 'Гребни и пена у камней' },
  { key: 'landmarks', label: 'Чаша и бронзовый лик', hint: 'Свечение, рябь и локальные эффекты ориентиров' },
  { key: 'lamps', label: 'Огонь и отражения', hint: 'Тёплые пятна на причале и воде' }
];
const signals: Field[] = [
  { key: 'signals', label: 'Сигналы ловли', hint: 'Рябь косяка и всплеск поклёвки' },
  { key: 'vignette', label: 'Виньетка', hint: 'Мягкое затемнение краёв' }
];

export function makeVisualInspector(root: HTMLElement, apply: (settings: VisualTuning) => void) {
  let settings = { ...defaultVisualTuning };
  try {
    const saved = localStorage.getItem(saveKey);
    if (saved) settings = readVisualTuning(JSON.parse(saved));
  } catch {
    // Defaults also work with browser storage disabled.
  }
  const list = root.querySelector<HTMLElement>('[role=tablist]')!;
  const panels = [...root.querySelectorAll<HTMLElement>('[role=tabpanel]')];
  const scroll = root.querySelector<HTMLElement>('.visual-scroll')!;
  const footer = root.querySelector<HTMLElement>('.visual-inspector-footer')!;
  const stage = root.querySelector<HTMLSelectElement>('#visual-stage')!;
  const tint = root.querySelector<HTMLInputElement>('#visual-sky-tint')!;
  const values = new Map<Gain, { input: HTMLInputElement; value: HTMLOutputElement }>();
  const buttons = tabs.map((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `visual-tab-${index}`;
    button.role = 'tab';
    button.textContent = name;
    button.setAttribute('aria-controls', panels[index].id);
    panels[index].setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => selectTab(index));
    button.addEventListener('keydown', event => {
      const navigation: Record<string, number> = { Home: 0, End: tabs.length - 1,
        ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length };
      const next = navigation[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectTab(next);
      buttons[next].focus();
    });
    list.append(button);
    return button;
  });

  function selectTab(index: number) {
    for (const [tabIndex, tab] of buttons.entries()) {
      const selected = index === tabIndex;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[tabIndex].hidden = !selected;
    }
    footer.hidden = index === 0;
    scroll.scrollTop = 0;
  }

  function save() {
    apply(settings);
    try { localStorage.setItem(saveKey, JSON.stringify(settings)); } catch {
      // Live preview still works with browser storage disabled.
    }
  }

  function sync() {
    stage.value = String(settings.stage);
    tint.value = settings.skyTint;
    for (const [key, field] of values) {
      field.input.value = String(settings[key]);
      field.value.value = Math.round(settings[key] * 100) + '%';
    }
  }

  function loadFields(target: HTMLElement, fields: Field[]) {
    for (const { key, label, hint } of fields) {
      const row = document.createElement('label');
      row.className = 'visual-slider';
      const name = document.createElement('span');
      name.textContent = label;
      const value = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `visual-${key}`;
      input.setAttribute('aria-label', label);
      input.title = hint;
      input.min = '0';
      input.max = key === 'skyTintMix' ? '1' : '2';
      input.step = '.01';
      value.htmlFor.add(input.id);
      input.addEventListener('input', () => {
        settings[key] = input.valueAsNumber;
        value.value = Math.round(settings[key] * 100) + '%';
        save();
      });
      row.append(name, value, input);
      target.append(row);
      values.set(key, { input, value });
    }
  }

  loadFields(root.querySelector('#visual-light-fields')!, atmosphere);
  loadFields(root.querySelector('#visual-effects-fields')!, effects);
  loadFields(root.querySelector('#visual-signal-fields')!, signals);
  stage.addEventListener('change', () => {
    settings.stage = stage.value === 'auto' ? 'auto' : Number(stage.value) as 0 | 1 | 2;
    save();
  });
  tint.addEventListener('input', () => {
    settings.skyTint = tint.value;
    save();
  });
  root.querySelector('#visual-reset')!.addEventListener('click', () => {
    settings = { ...defaultVisualTuning };
    sync();
    save();
  });
  selectTab(0);
  sync();
  apply(settings);
}
