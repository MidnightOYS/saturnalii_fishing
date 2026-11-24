import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../dist/', import.meta.url);
let page = await readFile(new URL('index.html', directory), 'utf8');
for (const [pattern, tag] of [
  [/<script type="module"[^>]* src="([^"]+)"[^>]*><\/script>/, 'script type="module"'],
  [/<link rel="stylesheet"[^>]* href="([^"]+)"[^>]*>/, 'style']
]) {
  const match = page.match(pattern);
  if (!match) throw new Error('Missing built entry for ' + tag);
  const end = tag.split(' ')[0];
  const content = await readFile(new URL(match[1], directory), 'utf8');
  page = page.replace(match[0], () => '<' + tag + '>\n' + content.replaceAll('</' + end, '<\\/' + end) + '\n</' + end + '>');
}
await writeFile(new URL('gnev-glubin-isometric.html', directory), page);
