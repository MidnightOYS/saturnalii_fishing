import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const demoModels = ['boat', 'bobber', 'dock_deck', 'rod'];
const gameBoatModels = ['blind-eye/boat', 'blind-eye/boat-oar', 'blind-eye/boat-sail-rig'];
const gameEnemyModels = ['hippocamp', 'karkinos', 'charybdis', 'cretan-bull'].map(name => `enemies/${name}`);
const locations = ['moon-cistern', 'bronze-harbor'];

async function inlinePngs(css, stylesheet) {
  const pngUrl = /url\((['"]?)(?:\.\/)?([a-z0-9_/-]+\.png)\1\)/gi;
  const paths = new Set([...css.matchAll(pngUrl)].map(match => match[2]));
  const images = new Map(await Promise.all([...paths].map(async path => {
    const bytes = await readFile(new URL(path, stylesheet));
    return [path, `data:image/png;base64,${bytes.toString('base64')}`];
  })));
  return css.replace(pngUrl, (_, quote, path) => `url(${images.get(path)})`);
}

async function standalone(entry, output, assets = [], maps = []) {
  const source = new URL(entry, dist);
  const page = await readFile(source, 'utf8');
  const script = page.match(/<script type="module"[^>]* src="([^"]+)"[^>]*><\/script>/);
  const style = page.match(/<link rel="stylesheet"[^>]* href="([^"]+)"[^>]*>/);
  if (!script || !style) throw new Error(`Expected one entry script and stylesheet for ${entry}.`);

  const stylesheet = new URL(style[1], source);
  const [code, css, licenses, models, layouts] = await Promise.all([
    readFile(new URL(script[1], source), 'utf8'),
    readFile(stylesheet, 'utf8').then(css => inlinePngs(css, stylesheet)),
    readFile(new URL('third-party-licenses.md', source), 'utf8'),
    Promise.all([...assets, ...maps.map(name => `locations/${name}`)].map(async path => {
      const namedGroup = path.startsWith('blind-eye/') || path.startsWith('enemies/');
      const basename = path.split('/').at(-1);
      const name = namedGroup ? path.replace('/', '-') : basename;
      const bytes = await readFile(new URL(`models/${path}.glb`, source));
      const compressed = namedGroup || path.startsWith('locations/');
      const encoded = (compressed ? gzipSync(bytes, { level: 9 }) : bytes).toString('base64');
      return `<script type="application/octet-stream" data-model="${name}"${compressed ? ' data-compression="gzip"' : ''}>${encoded}</script>`;
    })),
    Promise.all(maps.map(async name => {
      const json = JSON.parse(await readFile(new URL(`models/locations/${name}-layout.json`, source), 'utf8'));
      return `<script type="application/json" data-layout="${name}">${JSON.stringify(json).replaceAll('<', '\\u003c')}</script>`;
    })),
  ]);

  const html = page
    .replace(script[0], () => '<script type="module">\n' + code.replaceAll('</script', '<\\/script') + '\n</script>')
    .replace(style[0], () => '<style>\n' + css + '\n</style>')
    .replace('</head>', () => '<!--\n' + licenses.replaceAll('-->', '--&gt;') + '\n-->\n</head>')
    .replace('</body>', () => [...models, ...layouts].join('\n') + '\n</body>');

  const destination = new URL(output, dist);
  await writeFile(destination, html);
  console.log('Standalone browser build:', fileURLToPath(destination));
}

await standalone('index.html', 'gnev-glubin-3d.html', [...gameBoatModels, ...gameEnemyModels], locations);
await standalone('water/water-demo.html', 'gnev-glubin-water.html', demoModels);
await standalone('watercolor/watercolor-demo.html', 'gnev-glubin-watercolor.html', demoModels);
await standalone('water-lab/water-lab.html', 'gnev-glubin-water-lab.html', demoModels);
await standalone('water-layers/water-layers.html', 'gnev-glubin-water-layers.html', demoModels);
await standalone('water-collection/water-collection.html', 'gnev-glubin-water-collection.html', demoModels);
