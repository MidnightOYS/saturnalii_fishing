import { readVisualTuning, type VisualGain, type VisualTuning } from './visual-tuning';
import { microEffects, screenFilters, type ScreenFilterId } from './visual-effects/presets';

const saveKey = 'gnev-glubin-3d.visual.v1';
const tabs = ['Вода', 'Свет и туман', 'Эффекты', 'Микродетали', 'Фильтры'] as const;

type Field = { key: VisualGain; label: string; hint: string };
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
  let settings = readVisualTuning();
  try {
    const saved = localStorage.getItem(saveKey);
    if (saved) settings = readVisualTuning(JSON.parse(saved));
  } catch {
    // Defaults also work with browser storage disabled.
  }
  const list = root.querySelector<HTMLElement>('[role=tablist]')!;
  const scroll = root.querySelector<HTMLElement>('.visual-scroll')!;
  for (const id of ['visual-micro', 'visual-filters']) {
    const panel = document.createElement('section');
    panel.id = id;
    panel.setAttribute('role', 'tabpanel');
    panel.hidden = true;
    scroll.append(panel);
  }
  const panels = [...root.querySelectorAll<HTMLElement>('[role=tabpanel]')];
  const footer = root.querySelector<HTMLElement>('.visual-inspector-footer')!;
  const stage = root.querySelector<HTMLSelectElement>('#visual-stage')!;
  const tint = root.querySelector<HTMLInputElement>('#visual-sky-tint')!;
  const syncFields: Array<() => void> = [];
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
    for (const refresh of syncFields) refresh();
    filter.value = settings.filter;
    const preset = screenFilters.find(({id}) => id === settings.filter);
    filterHelp.textContent = preset?.hint ?? 'Один экранный фильтр поверх света, воды и микродеталей.';
    filterSlider.hidden = !preset;
  }

  function addSlider(target: HTMLElement, key: string, label: string, hint: string, max: number,
    read: () => number, write: (value: number) => void) {
    const row = document.createElement('label');
    row.className = 'visual-slider';
    const name = document.createElement('span');
    name.textContent = label;
    const output = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `visual-${key}`;
    input.setAttribute('aria-label', label);
    input.title = hint;
    input.min = '0';
    input.max = String(max);
    input.step = '.01';
    output.htmlFor.add(input.id);
    const refresh = () => {
      input.value = String(read());
      output.value = Math.round(read() * 100) + '%';
    };
    input.addEventListener('input', () => {
      write(input.valueAsNumber);
      refresh();
      save();
    });
    syncFields.push(refresh);
    row.append(name, output, input);
    target.append(row);
    return row;
  }

  function loadFields(target: HTMLElement, fields: Field[]) {
    for (const { key, label, hint } of fields) {
      addSlider(target, key, label, hint, key === 'skyTintMix' ? 1 : 2,
        () => settings[key], value => { settings[key] = value; });
    }
  }

  const microPanel = root.querySelector<HTMLElement>('#visual-micro')!;
  const microHint = document.createElement('p');
  microHint.className = 'visual-help visual-micro-help';
  microHint.textContent = 'Слои можно сочетать. При 0% слой выключен.';
  microPanel.append(microHint);
  for (const group of new Set(microEffects.map(effect => effect.group))) {
    const section = document.createElement('div');
    section.className = 'visual-section';
    const heading = document.createElement('h3');
    heading.textContent = group;
    section.append(heading);
    for (const {id, label, hint} of microEffects.filter(effect => effect.group === group)) {
      addSlider(section, `micro-${id}`, label, hint, 1,
        () => settings.micro[id], value => { settings.micro[id] = value; });
    }
    microPanel.append(section);
  }
  const clearMicro = document.createElement('button');
  clearMicro.type = 'button';
  clearMicro.className = 'visual-clear-micro';
  clearMicro.textContent = 'Выключить микродетали';
  clearMicro.addEventListener('click', () => {
    for (const {id} of microEffects) settings.micro[id] = 0;
    sync();
    save();
  });
  microPanel.append(clearMicro);

  const filterPanel = root.querySelector<HTMLElement>('#visual-filters')!;
  const filterSection = document.createElement('div');
  filterSection.className = 'visual-section';
  const filterRow = document.createElement('label');
  filterRow.className = 'visual-select visual-filter-select';
  const filterName = document.createElement('span');
  filterName.textContent = 'Фильтр';
  const filter = document.createElement('select');
  filter.id = 'visual-screen-filter';
  filter.add(new Option('Без фильтра', 'none'));
  for (const {id, label} of screenFilters) filter.add(new Option(label, id));
  filter.addEventListener('change', () => {
    settings.filter = filter.value as 'none' | ScreenFilterId;
    sync();
    save();
  });
  filterRow.append(filterName, filter);
  const filterHelp = document.createElement('p');
  filterHelp.className = 'visual-help';
  filterSection.append(filterRow, filterHelp);
  const filterSlider = addSlider(filterSection, 'filter-strength', 'Интенсивность фильтра', '', 1,
    () => settings.filter === 'none' ? 0 : settings.filterStrengths[settings.filter],
    value => { if (settings.filter !== 'none') settings.filterStrengths[settings.filter] = value; });
  filterPanel.append(filterSection);

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
    settings = readVisualTuning();
    sync();
    save();
  });
  selectTab(0);
  sync();
  apply(settings);
}
