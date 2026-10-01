// electron-builder afterPack: writes the app icon into the .exe. signAndEditExecutable stays false (it would
// download winCodeSign, which the TLS proxy blocks), so we run the rcedit that ships with electron-winstaller.
// Throws on failure so `bun run pack` never ships an exe with Electron's default icon.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function stampIcon({ appOutDir, packager, electronPlatformName }) {
  if (electronPlatformName !== 'win32') return; // rcedit.exe is a Windows tool
  const root = packager.projectDir;
  const rcedit = join(root, 'node_modules/electron-winstaller/vendor/rcedit.exe');
  const exe = join(appOutDir, `${packager.appInfo.productFilename}.exe`);
  execFileSync(rcedit, [exe, '--set-icon', join(root, 'assets/app-icons/personal-assistant.ico')], { stdio: 'inherit' });
};
