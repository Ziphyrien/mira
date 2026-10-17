// Fetch the CC0 background photo from Wikimedia Commons and render light/dark variants.
// Source: "Alone in the unspoilt wilderness" by David Marcu (Unsplash), CC0.
import sharp from 'sharp';

const SRC = 'https://upload.wikimedia.org/wikipedia/commons/0/01/Alone_in_the_unspoilt_wilderness_%28Unsplash%29.jpg';
const OUT = 'src/lib/assets';

const res = await fetch(SRC, { headers: { 'User-Agent': 'mira-build/1.0 (asset fetch)' } });
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const base = sharp(Buffer.from(await res.arrayBuffer())).resize(2400, 1350, { fit: 'cover', position: 'attention' });

await base.clone().modulate({ saturation: 0.7, brightness: 1.06 }).linear(0.9, 18).blur(1.2).jpeg({ quality: 82, mozjpeg: true }).toFile(`${OUT}/scene-light.jpg`);
await base.clone().modulate({ saturation: 0.5, brightness: 0.55 }).tint({ r: 70, g: 90, b: 130 }).blur(1.2).jpeg({ quality: 82, mozjpeg: true }).toFile(`${OUT}/scene-dark.jpg`);
console.log('scenes written');
