import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);

async function standalone(entry, output, assets = []) {
  const source = new URL(entry, dist);
  const page = await readFile(source, 'utf8');
  const script = page.match(/<script type="module"[^>]* src="([^"]+)"[^>]*><\/script>/);
  const style = page.match(/<link rel="stylesheet"[^>]* href="([^"]+)"[^>]*>/);
  if (!script || !style) throw new Error(`Expected one entry script and stylesheet for ${entry}.`);

  const [code, css, licenses, models] = await Promise.all([
    readFile(new URL(script[1], source), 'utf8'),
    readFile(new URL(style[1], source), 'utf8'),
    readFile(new URL('third-party-licenses.md', source), 'utf8'),
    Promise.all(assets.map(async name => {
      const bytes = await readFile(new URL(`models/${name}.glb`, source));
      return `<script type="application/octet-stream" data-model="${name}">${bytes.toString('base64')}</script>`;
    })),
  ]);

  const html = page
    .replace(script[0], () => '<script type="module">\n' + code.replaceAll('</script', '<\\/script') + '\n</script>')
    .replace(style[0], () => '<style>\n' + css + '\n</style>')
    .replace('</head>', () => '<!--\n' + licenses.replaceAll('-->', '--&gt;') + '\n-->\n</head>')
    .replace('</body>', () => models.join('\n') + '\n</body>');

  const destination = new URL(output, dist);
  await writeFile(destination, html);
  console.log('Standalone browser build:', fileURLToPath(destination));
}

await standalone('index.html', 'gnev-glubin-3d.html');
await standalone('water/water-demo.html', 'gnev-glubin-water.html', ['boat', 'bobber', 'dock_deck', 'rod']);
