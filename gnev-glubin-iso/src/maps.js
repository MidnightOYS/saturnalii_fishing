// Coordinates in the scene reference frame, before scaling to the viewport.
export const width = 1200;
export const height = 690;
export const origin = { x: 600, y: 345 };
export const tile = { x: 24, y: 12 };
export const project = ({ x, y }) => ({ x: origin.x + (x - y) * tile.x, y: origin.y + (x + y) * tile.y });
export const unproject = ({ x, y }) => ({
  x: ((x - origin.x) / tile.x + (y - origin.y) / tile.y) / 2,
  y: ((y - origin.y) / tile.y - (x - origin.x) / tile.x) / 2
});
export const at = (x, y) => unproject({ x, y });
export const dock = at(603, 555);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const cistern = {
  name: 'Лунная цистерна', number: 'I',
  description: 'Лунный водосбор у старой оливы. Начни у ближнего косяка, за деревянными мостками.',
  land: '#333833', water: ['#547074', '#274c53', '#182c3b'], shallow: '#6e827c',
  bank: [[83,309],[116,262],[193,230],[235,184],[333,153],[421,155],[486,132],[606,128],[694,149],[796,146],[884,163],[950,200],[1017,221],[1089,270],[1121,330],[1112,393],[1074,423],[1062,457],[992,500],[923,522],[852,574],[752,585],[673,611],[542,615],[442,606],[362,570],[252,553],[192,512],[131,472],[103,409],[71,368]],
  islands: [[325,350,2.5],[888,281,2.05]],
  schools: [[559,469],[729,449],[472,363],[710,321],[949,391],[410,479],[580,230],[788,532]],
  art: [
    ['tree',206,245,188],['shrine',359,206,150],['cypress',463,154,89],['tree',813,160,135],
    ['cypress',969,212,123],['rock',1077,290,114],['tree',1059,449,140],['cypress',981,506,132],
    ['tree',841,583,168],['rock',463,618,140],['tree',254,564,162],['cypress',95,419,123],
    ['tree',323,349,120],['rock',287,357,55],['shrine',897,276,87],['vase',872,291,20],
    ['lamp',564,600,24],['lamp',646,593,24],['vase',660,622,32],['cypress',16,581,130],
    ['rock',1122,584,144],['rock',132,627,106]
  ]
};

const harbor = {
  name: 'Бронзовая гавань', number: 'II',
  description: 'На дне лежит лицо великана. Здесь быстрее растёт гнев, а в косяках чаще встречается редкий улов.',
  land: '#383333', water: ['#536c69', '#29464a', '#172835'], shallow: '#8b8274',
  bank: [[66,309],[119,253],[206,243],[263,197],[365,191],[408,139],[560,124],[693,135],[751,167],[863,163],[956,194],[1017,249],[1102,278],[1133,345],[1108,415],[1048,463],[977,475],[936,530],[824,558],[728,595],[652,604],[525,610],[456,583],[333,590],[255,549],[188,538],[167,489],[111,467],[76,403]],
  islands: [[775,275,2.85],[375,391,2.65],[957,351,1.6]],
  schools: [[559,469],[731,445],[510,329],[857,421],[333,302],[971,407],[628,226],[384,523]],
  art: [
    ['cypress',174,264,123],['shrine',302,207,149],['cypress',435,169,115],['rock',526,154,96],
    ['shrine',916,222,153],['cypress',1016,251,144],['rock',1108,411,118],['cypress',988,474,142],
    ['tree',843,568,146],['rock',426,600,145],['cypress',189,547,144],['cypress',85,419,113],
    ['face',777,277,211],['rock',373,394,148],['vase',412,399,24],['rock',958,352,89],
    ['lamp',559,601,25],['lamp',650,590,26],['vase',661,618,35],['rock',92,592,151],
    ['cypress',1040,613,177],['rock',1142,573,143]
  ]
};

export const maps = { pond: cistern, temple: harbor };

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function navigable(map, point, margin = 0) {
  const samples = [[0,0],[-margin,0],[margin,0],[0,-margin],[0,margin]];
  return samples.every(([x, y]) => {
    const p = project({ x: point.x + x, y: point.y + y });
    return pointInPolygon(p.x, p.y, map.bank);
  }) && map.islands.every(([x, y, radius]) => distance(at(x, y), point) > radius + margin);
}
