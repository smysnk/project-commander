const { createMasterClient } = require('./masterClient');

const run = async () => {
  const master = createMasterClient();
  const smokeProjectPath = process.env.SMOKE_PROJECT_PATH;
  try {
    const health = await master.health({ timeoutMs: 3000 });
    const version = await master.getVersion({ timeoutMs: 3000 });
    const handshake = await master.handshake({ timeoutMs: 3000 });

    console.log('Master health:', JSON.stringify(health, null, 2));
    console.log('Master version:', JSON.stringify(version, null, 2));
    console.log('Master handshake:', JSON.stringify(handshake, null, 2));

    if (smokeProjectPath) {
      const snapshot = await master.getRuntimeSnapshot({
        projectPath: smokeProjectPath,
        timeoutMs: 3000,
      });
      console.log('Master runtime snapshot:', JSON.stringify(snapshot, null, 2));
    }
  } finally {
    master.close();
  }
};

run().catch((error) => {
  console.error(`Master smoke check failed: ${error?.message || error}`);
  process.exit(1);
});
