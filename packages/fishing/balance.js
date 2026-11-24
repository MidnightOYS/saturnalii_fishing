// Game rules adapted from poseidons-pond/balance.js.
// [default, minimum, maximum, step, interface label]
const schema = {
  aim: ['Заброс и рыбные места', {
    sweep: [0.97, .25, 5, .01, 'Ход сектора в одну сторону, с'],
    range: [.76, .3, 1, .01, 'Размах сектора, рад'],
    width: [.13, .025, .30, .005, 'Полуширина сектора, рад'],
    precision: [.78, .25, 1, .01, 'Доля ширины для попадания'],
    spots: [2, 1, 5, 1, 'Рыбных мест на воде'],
    spotRefresh: [13, 3, 90, .5, 'Смена мест, с'],
    flight: [.56, .15, 2, .01, 'Полёт поплавка, с'],
    flatDepth: [.69, .43, .9, .01, 'Глубина обычного заброса'],
    distance: [16, 2, 48, .5, 'Начальная длина лески, м'],
    depthDistance: [7, 0, 25, .5, 'Добавка к длине от глубины, м']
  }],
  bite: ['Поклёвка и подсечка', {
    normalChance: [.68, 0, 1, .01, 'Базовый шанс поклёвки'],
    spotChance: [.29, 0, 1, .01, 'Бонус поклёвки в рыбном месте'],
    templeChance: [.02, 0, 1, .01, 'Бонус поклёвки у храма'],
    normalWait: [2.38, .1, 15, .05, 'Пауза до поклёвки, с'],
    spotWait: [1.18, .1, 15, .05, 'Пауза в рыбном месте, с'],
    waitSpread: [1.4, 0, 15, .05, 'Случайная добавка к паузе, с'],
    markerSweep: [.93, .2, 4, .01, 'Ход риски в одну сторону, с'],
    bandStart: [.64, 0, .95, .01, 'Начало зоны на шкале'],
    bandEnd: [.80, .05, 1, .01, 'Конец зоны на шкале'],
    window: [3.12, .5, 12, .01, 'Время на подсечку, с'],
    startTension: [17, 0, 95, 1, 'Начальное натяжение, %']
  }],
  fight: ['Вываживание', {
    turnTime: [.95, .25, 8, .01, 'Минимум между рывками, с'],
    turnSpread: [.47, 0, 5, .01, 'Случайная добавка к рывку, с'],
    grace: [.37, 0, 2, .01, 'Запас на смену направления, с'],
    correctEase: [39, 0, 120, 1, 'Спад натяжения при контррывке, %/с'],
    graceGain: [1, 0, 40, 1, 'Рост натяжения в запасе, %/с'],
    wrongGain: [43, 0, 120, 1, 'Рост натяжения при ошибке, %/с'],
    neutralGain: [16, 0, 120, 1, 'Рост натяжения без ввода, %/с'],
    earlyReelGain: [65, 0, 150, 1, 'Штраф за раннюю подмотку, %/с'],
    fatigue: [.83, .05, 4, .01, 'Утомление при контррывке, 1/с'],
    passiveFatigue: [.13, 0, 2, .01, 'Пассивное утомление, 1/с'],
    wrongDistance: [1.2, 0, 8, .05, 'Удаление при ошибке, м/с'],
    neutralDistance: [.58, 0, 8, .01, 'Удаление без ввода, м/с'],
    maxDistance: [32, 5, 80, 1, 'Предел длины лески, м'],
    slackEase: [58, 0, 150, 1, 'Спад натяжения у уставшей рыбы, %/с'],
    reelSpeed: [9.25, 1, 45, .25, 'Скорость подмотки, м/с'],
    reelWindow: [1.48, .3, 8, .01, 'Окно подмотки, с'],
    landingDistance: [.75, .1, 4, .05, 'Дистанция поимки, м'],
    upgradedLine: [.76, .1, 1, .01, 'Множитель роста натяжения с улучшенной леской']
  }],
  loot: ['Распределение улова', {
    rareCalm: [.10, 0, 1, .01, 'Шанс редкой рыбы в спокойной воде'],
    rareRising: [.28, 0, 1, .01, 'Шанс редкой рыбы при знамении'],
    rareWrath: [.72, 0, 1, .01, 'Шанс Венца глубин при ярости'],
    spotRare: [.29, 0, 1, .01, 'Бонус редкости за рыбное место'],
    templeRare: [.10, 0, 1, .01, 'Бонус редкости у храма'],
    mulletShare: [.50, 0, 1, .01, 'Доля кефали среди обычного улова'],
    viperShare: [.57, 0, 1, .01, 'Доля проклятой рыбы среди редких при знамении']
  }],
  wrath: ['Гнев и нападения', {
    pondRate: [.69, 0, 15, .01, 'Рост в пруду, %/с'],
    templeRate: [.91, 0, 15, .01, 'Рост у храма, %/с'],
    rising: [32, 1, 98, 1, 'Порог знамения, %'],
    wrath: [65, 2, 99, 1, 'Порог ярости, %'],
    visualTransition: [2.4, .4, 8, .1, 'Переход оформления на одну стадию, с'],
    finalPause: [1.65, .3, 7, .05, 'Время показа финальной волны, с'],
    firstAttack: [7, .5, 60, .5, 'До первой атаки при ярости, с'],
    attackInterval: [9, .5, 60, .5, 'Минимум между атаками, с'],
    attackSpread: [7, 0, 45, .5, 'Случайная добавка между атаками, с'],
    attackWindow: [1.8, .25, 8, .05, 'Время на отпугивание, с'],
    attackDamage: [1, 0, 12, 1, 'Урон прислужника, ед.'],
    dogRescues: [1, 0, 5, 1, 'Сколько раз спасает Аргос'],
    health: [3, 1, 12, 1, 'Здоровье Одиссея, ед.'],
    offeringCalm: [21, 0, 100, 1, 'Снятие гнева в спокойной воде, %'],
    offeringRising: [10, 0, 100, 1, 'Снятие гнева при знамении, %'],
    offeringWrath: [0, 0, 100, 1, 'Снятие гнева при ярости, %'],
    offeringMinimum: [2, 0, 99, 1, 'Минимум гнева для подношения, %']
  }],
  economy: ['Квота, трюм и магазин', {
    quota: [2, 1, 30, 1, 'Квота, очки улова'],
    columns: [5, 3, 9, 1, 'Столбцы трюма'],
    rows: [3, 2, 7, 1, 'Строки трюма'],
    stackLimit: [3, 1, 15, 1, 'Максимум одинаковых рыб в стопке'],
    gold: [0, 0, 999, 1, 'Драхмы при новом старте'],
    offerings: [1, 0, 40, 1, 'Подношения при новом старте'],
    boat: [25, 0, 999, 1, 'Ремонт лодки, драхмы'],
    line: [18, 0, 999, 1, 'Крепкая леска, драхмы'],
    offering: [7, 0, 999, 1, 'Подношение, драхмы']
  }]
};

const fishDefaults = {
  mullet: ['Серебряная кефаль', 1, 13, 5, 2, 1, .93, 1.4, 0],
  perch: ['Каменный окунь', 1, 15, 6, 2, 1, 1.04, 1.4, 0],
  oracle: ['Оракульская рыба', 2, 32, 14, 3, 1, 1.15, 3.6, 0],
  viper: ['Рыба с проклятым жалом', 2, 44, 18, 2, 2, 1.24, 3.6, 1],
  crown: ['Венец глубин', 2, 70, 27, 3, 2, 1.33, 3.6, 0]
};
for (const [id, [name, points, value, xp, width, height, pull, wrath, damage]] of Object.entries(fishDefaults)) {
  schema[id] = [name, {
    points: [points, 0, 30, 1, 'Очки квоты'],
    value: [value, 0, 999, 1, 'Цена, драхмы'],
    xp: [xp, 0, 999, 1, 'Опыт'],
    width: [width, 1, 9, 1, 'Ширина в трюме'],
    height: [height, 1, 7, 1, 'Высота в трюме'],
    pull: [pull, .1, 4, .01, 'Сила рывка'],
    wrath: [wrath, 0, 60, .1, 'Гнев после поимки, %'],
    damage: [damage, 0, 12, 1, 'Урон после поимки, ед.']
  }];
}

const defaults = () => Object.fromEntries(Object.entries(schema).map(([group, [, fields]]) => [
  group, Object.fromEntries(Object.entries(fields).map(([key, [value]]) => [key, value]))
]));

function normalize(raw) {
  const result = defaults();
  for (const [group, [, fields]] of Object.entries(schema)) {
    for (const [key, [, min, max, step]] of Object.entries(fields)) {
      const value = raw?.[group]?.[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const bounded = Math.min(max, Math.max(min, value));
      result[group][key] = step === 1 ? Math.round(bounded) : Number(bounded.toFixed(4));
    }
  }
  result.bite.bandEnd = Math.max(Number((result.bite.bandStart + .05).toFixed(4)), result.bite.bandEnd);
  result.wrath.wrath = Math.max(result.wrath.rising + 1, result.wrath.wrath);
  return result;
}

export { schema, defaults, normalize };
