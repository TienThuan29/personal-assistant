import { readFileSync } from 'node:fs';

describe('app icon', () => {
  it('.ico has the frames Windows needs (tray 16/32, taskbar/installer 256)', () => {
    const b = readFileSync('assets/app-icons/personal-assistant.ico');
    const sizes = Array.from({ length: b.readUInt16LE(4) }, (_, i) => b[6 + i * 16] || 256);
    expect(sizes).toEqual(expect.arrayContaining([16, 32, 256]));
  });

  it.each([16, 32, 64, 128, 256, 512, 1024])('icon-%i.png is %i px square', (n) => {
    const b = readFileSync(`assets/app-icons/icon-${n}.png`);
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([n, n]); // PNG IHDR width, height
  });
});
