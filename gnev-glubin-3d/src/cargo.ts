import type { Pond } from './rules/game.js';

export type Cargo = NonNullable<NonNullable<Pond['run']>['pending']> & { rotation?: number };
type Cell = { x: number; y: number };

export function cargoCells(item: Cargo, x = item.x, y = item.y): Cell[] {
  const [width, height] = item.size;
  const rotation = item.rotation ?? Number(item.turned);
  const cells: Cell[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (item.id === 'viper' && width === 2 && height === 2 && row === 1 && column === 1) continue;
      if (item.id === 'crown' && width === 3 && height === 2 && row === 1 && column !== 1) continue;
      switch (rotation) {
        case 1: cells.push({ x: x + height - 1 - row, y: y + column }); break;
        case 2: cells.push({ x: x + width - 1 - column, y: y + height - 1 - row }); break;
        case 3: cells.push({ x: x + row, y: y + width - 1 - column }); break;
        default: cells.push({ x: x + column, y: y + row });
      }
    }
  }
  return cells;
}

export function rotateCargo(item: Cargo): Cargo {
  const rotation = ((item.rotation ?? Number(item.turned)) + 1) % 4;
  return { ...item, rotation, turned: rotation % 2 === 1 };
}
