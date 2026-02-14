import { pullSnapshotFromDrive, pushSnapshotToDrive } from './driveSync.js';

const cmd = process.argv[2];
const filename = process.env.DRIVE_SYNC_FILENAME;

async function main() {
  if (cmd === 'push') {
    const res = await pushSnapshotToDrive({ filename });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === 'pull') {
    const res = await pullSnapshotFromDrive({ filename });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // eslint-disable-next-line no-console
  console.error('Usage: node src/drive/cli.js <push|pull>');
  process.exit(2);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
