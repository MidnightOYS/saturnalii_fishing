export const palettes = [
  { name: 'Эгейское утро', shallow: '#55ada2', deep: '#174b59', ink: '#22293c', sun: '#faf0cd',
    sky: '#59757a', elevation: .82, clarity: 2.4, glints: 1.15, caustics: .78, brush: .70, grain: .45, relief: .34 },
  { name: 'Под оливами', shallow: '#89a176', deep: '#234d42', ink: '#27302b', sun: '#ffe4a9',
    sky: '#647464', elevation: .71, clarity: 2.93, glints: .85, caustics: .88, brush: .59, grain: .58, relief: .31 },
  { name: 'Медный закат', shallow: '#59867b', deep: '#1c475b', ink: '#322b4d', sun: '#ffbd72',
    sky: '#ad8a79', elevation: .40, clarity: 2.03, glints: 1.44, caustics: .62, brush: .75, grain: .48, relief: .42 },
  { name: 'Лунная цистерна', shallow: '#6e9fba', deep: '#223c62', ink: '#141d38', sun: '#cddfff',
    sky: '#3b5474', elevation: .68, clarity: 1.95, glints: .87, caustics: .50, brush: .68, grain: .37, relief: .27 },
] as const;

export function get<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

export function bindWatercolorInspector() {
  const look = { bottom: true, painted: true, clarity: 2.4, glints: 1.15, caustics: .78,
    waveHeight: .81, foam: 1, brush: .70, grain: .45, relief: .34, renderScale: 1, wrathRate: 2.6 };
  const select = get<HTMLSelectElement>('preset');
  const auto = get<HTMLInputElement>('auto-wrath');
  const wrath = get<HTMLInputElement>('preview-wrath');
  const readout = get<HTMLOutputElement>('preview-value');
  const pause = get<HTMLButtonElement>('pause');
  const stageButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-wrath]')];
  let paused = false;
  const refresh: (() => void)[] = [];

  function slider(key: keyof typeof look, title: string, parent: string, min: number, max: number, step = .01) {
    const label = document.createElement('label');
    const output = document.createElement('output');
    const input = document.createElement('input');
    const text = document.createElement('span');
    text.textContent = title;
    label.className = 'range';
    input.type = 'range';
    input.id = key;
    output.setAttribute('for', key);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const draw = () => { input.value = String(look[key]); output.value = input.value; };
    input.addEventListener('input', () => { Object.assign(look, { [key]: input.valueAsNumber }); draw(); });
    refresh.push(draw);
    label.append(text, output, input);
    get(parent).append(label);
  }

  function toggle(key: 'bottom' | 'painted', title: string, parent: string) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    label.className = 'toggle';
    label.textContent = title;
    input.type = 'checkbox';
    input.id = key;
    input.addEventListener('change', () => { look[key] = input.checked; });
    refresh.push(() => { input.checked = look[key]; });
    label.append(input);
    get(parent).append(label);
  }

  toggle('bottom', 'Растительность и дно', 'water-settings');
  slider('clarity', 'Прозрачность', 'water-settings', .3, 3.4);
  slider('glints', 'Световые штрихи', 'water-settings', 0, 2);
  slider('caustics', 'Свет на дне', 'water-settings', 0, 1.8);
  slider('waveHeight', 'Высота волн', 'water-settings', 0, 1.6);
  slider('foam', 'Пена и след', 'water-settings', 0, 2);
  toggle('painted', 'Акварельный проход', 'paint-settings');
  slider('brush', 'Размер мазка', 'paint-settings', 0, 1);
  slider('grain', 'Зерно бумаги', 'paint-settings', 0, 1);
  slider('relief', 'Рельеф пигмента', 'paint-settings', 0, 1);
  slider('renderScale', 'Масштаб рендера', 'scene-settings', .6, 1, .05);
  slider('wrathRate', 'Прирост гнева, %/с', 'scene-settings', .3, 7, .1);

  for (const [i, palette] of palettes.entries()) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = palette.name;
    select.append(option);
  }
  const swatches = document.querySelectorAll<HTMLElement>('.swatches i');
  const palette = () => palettes[Number(select.value)] ?? palettes[0];
  function applyPreset() {
    const { clarity, glints, caustics, brush, grain, relief, shallow, deep, ink, sun } = palette();
    Object.assign(look, { clarity, glints, caustics, brush, grain, relief });
    [shallow, deep, ink, sun].forEach((color, index) => { swatches[index].style.backgroundColor = color; });
    refresh.forEach(draw => draw());
  }
  applyPreset();
  select.addEventListener('change', applyPreset);

  function showWrath(value: number) {
    const rounded = Math.round(value);
    wrath.value = String(rounded);
    readout.value = `${rounded}%`;
    for (const button of stageButtons) button.setAttribute('aria-pressed', String(!auto.checked && Number(button.dataset.wrath) === rounded));
  }
  function preview(value: number) {
    auto.checked = false;
    showWrath(value);
  }
  auto.addEventListener('change', () => showWrath(wrath.valueAsNumber));
  wrath.addEventListener('input', () => preview(wrath.valueAsNumber));
  stageButtons.forEach(button => button.addEventListener('click', () => preview(Number(button.dataset.wrath))));

  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Продолжить' : 'Стоп-кадр';
    pause.setAttribute('aria-pressed', String(paused));
  });

  get('export').addEventListener('click', () => {
    const json = JSON.stringify({
      schema: 'gnev-glubin-watercolor', version: 1, palette: palette(), settings: look,
      wrath: { auto: auto.checked, value: wrath.valueAsNumber }, paused,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.download = 'gnev-glubin-watercolor.json';
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return { look, palette, showWrath,
    get paused() { return paused; },
    get automatic() { return auto.checked; },
    get wrath() { return wrath.valueAsNumber; },
  };
}
