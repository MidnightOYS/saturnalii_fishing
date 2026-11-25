import { fish } from '../rules/game.js';
import { conditionNames, entryFee, stakeKey, type FishStake, type Polyphemus } from './rules';

const number = new Intl.NumberFormat('ru-RU');
const coins = (value: number) => number.format(value) + ' др.';
const multiplier = (value: number) => '×' + (value / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const fishPicture = (stake?: FishStake) => stake
  ? `<span class="poly-fish" data-species="${stake.id}" data-condition="${stake.condition}" aria-hidden="true"></span>`
  : '';
const fishLabel = (stake: FishStake) => `${fish[stake.id].name} · ${conditionNames[stake.condition].toLowerCase()}`;

function portrait() {
  return `<div class="poly-portrait">
    <div class="poly-art" aria-hidden="true"><div class="poly-jaw"></div><div class="poly-head"></div></div>
    <div class="poly-caption"><span>Циклоп</span><strong>Полифем</strong></div>
  </div>`;
}

export function polyphemusSetup(game: Polyphemus, gold: number, selected: string) {
  const inventory = game.inventory();
  const stake = inventory.find(item => stakeKey(item) === selected) ?? inventory[0];
  const canPay = gold >= entryFee;
  const form = stake
    ? `<div class="poly-picker">${fishPicture(stake)}
        <div><label for="poly-stake">Рыба из улова</label>
        <select id="poly-stake" autofocus>${inventory.map(item => `<option value="${stakeKey(item)}"
          ${stakeKey(item) === stakeKey(stake) ? 'selected' : ''}>${fishLabel(item)} · ${item.count} шт.</option>`).join('')}</select></div>
      </div>
      <dl class="poly-terms">
        <div><dt>Цена в лавке</dt><dd>${coins(stake.price)}</dd></div>
        <div><dt>Взнос</dt><dd>${coins(entryFee)}</dd></div>
        <div><dt>Кошелёк</dt><dd>${coins(gold)}</dd></div>
      </dl>`
    : `<p class="poly-notice">На причале пока нет улова. Привези рыбу из вылазки.</p>`;

  return `<div class="poly-body poly-setup">
    <div class="poly-details">
      <p class="poly-copy">Рыба мечется вверх и вниз. Зафиксируй её цену, пока Полифем не сомкнул челюсти.</p>
      ${form}
      ${stake && !canPay ? `<p class="poly-notice">Нужно ${coins(entryFee)} на взнос. Можно продать одну рыбу в лавке.</p>` : ''}
      <div class="poly-controls">
        ${stake && !canPay ? '<button type="button" data-action="poly-shop">Открыть лавку</button>' : ''}
        <button type="button" class="poly-primary" data-action="poly-start" ${stake && canPay ? '' : 'disabled'}>Бросить рыбу</button>
      </div>
      <p class="poly-footnote">Взнос списывается сразу. При укусе выплата сгорает, а рыба возвращается дешевле.</p>
    </div>
    ${portrait()}
  </div>`;
}

export function polyphemusRound(round: NonNullable<Polyphemus['round']>) {
  return `<div class="poly-body poly-playing" data-warning="open">
    <div class="poly-details">
      <div class="poly-live">
        <div class="poly-quote">
          <span class="poly-kicker">Множитель</span>
          <strong data-poly-multiplier>×0,50</strong>
          <span class="poly-kicker poly-payout-label">Выплата за рыбу</span>
          <span data-poly-payout>${coins(Math.floor(round.basePrice / 2))}</span>
        </div>
        <div class="poly-meter" aria-hidden="true"><div class="poly-rail"></div>
          <div class="poly-swimmer">${fishPicture(round.stake)}</div>
        </div>
      </div>
      <progress class="poly-time" value="0" max="1" aria-label="До смыкания пасти"></progress>
      <p class="poly-signal" data-poly-signal role="status">Полифем разевает пасть…</p>
      <div class="poly-controls"><button class="poly-primary" type="button" data-action="poly-cashout"
        aria-keyshortcuts="Space" aria-disabled="true">Зафиксировать <kbd>Пробел</kbd></button></div>
    </div>
    ${portrait()}
  </div>`;
}

export function polyphemusResult(game: Polyphemus, gold: number) {
  const result = game.outcome!;
  const paid = result.kind === 'paid';
  const stake = paid ? result.stake : result.returned;
  const main = paid
    ? `<p class="poly-result-number">${coins(result.quote.payout)}</p>
      <p class="poly-copy">Цена рыбы ${coins(result.basePrice)} · множитель ${multiplier(result.quote.multiplier)}.</p>`
    : `<p class="poly-result-number">0 др.</p>
      <p class="poly-copy">Полифем укусил рыбу. Она вернулась в улов.</p>
      <p class="poly-notice">${fishLabel(result.returned)} · в лавке ${coins(game.price(result.returned))}</p>`;
  const jaw = paid ? result.quote.jaw.toFixed(4) : '1';
  return `<div class="poly-body poly-result" data-outcome="${result.kind}" style="--jaw:${jaw}">
    <div class="poly-details">
      <div class="poly-settlement" role="status">
        ${fishPicture(stake)}${main}
      </div>
      <dl class="poly-terms">
        <div><dt>Взнос</dt><dd>−${coins(entryFee)}</dd></div>
        <div><dt>Кошелёк</dt><dd>${coins(gold)}</dd></div>
      </dl>
      <div class="poly-controls">
        <button type="button" data-action="close-menu">К причалу</button>
        <button type="button" class="poly-primary" data-action="poly-again">К выбору рыбы</button>
      </div>
    </div>${portrait()}
  </div>`;
}

export function bindPolyphemusFrame(root: HTMLElement) {
  const frame = root.querySelector<HTMLElement>('.poly-playing')!;
  const multiplierNode = frame.querySelector<HTMLElement>('[data-poly-multiplier]')!;
  const payout = frame.querySelector<HTMLElement>('[data-poly-payout]')!;
  const signal = frame.querySelector<HTMLElement>('[data-poly-signal]')!;
  const track = frame.querySelector<HTMLProgressElement>('.poly-time')!;
  const cashout = frame.querySelector<HTMLButtonElement>('[data-action="poly-cashout"]')!;
  let lastMultiplier = 50;
  let lastSignal = '';

  return (quote: NonNullable<ReturnType<Polyphemus['quote']>>) => {
    frame.style.setProperty('--jaw', quote.jaw.toFixed(4));
    frame.style.setProperty('--height', quote.height.toFixed(4));
    track.value = 1 - quote.jaw;
    if (lastMultiplier !== quote.multiplier) {
      lastMultiplier = quote.multiplier;
      multiplierNode.textContent = multiplier(quote.multiplier);
      payout.textContent = coins(quote.payout);
    }
    const state = quote.opening ? 'opening' : quote.jaw >= .77 ? 'danger' : quote.jackpot ? 'crest' : 'open';
    if (lastSignal !== state) {
      lastSignal = state;
      frame.dataset.warning = state;
      cashout.setAttribute('aria-disabled', String(quote.opening));
      signal.textContent = {
        opening: 'Полифем разевает пасть…',
        danger: 'Пасть захлопывается!',
        crest: 'Редкий всплеск',
        open: 'Пасть закрывается'
      }[state];
    }
  };
}
