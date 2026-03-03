const fs = require('fs');
const path = require('path');
const { sequelize } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const META_TABLE = 'SequelizeMeta';

const normalizeTableName = (value) =>
  String(Array.isArray(value) ? value[value.length - 1] : value).replace(/^"|"$/g, '');

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.map(normalizeTableName).includes(tableName);
}

async function ensureMetaTable(queryInterface, Sequelize) {
  if (await tableExists(queryInterface, META_TABLE)) {
    return;
  }

  await queryInterface.createTable(META_TABLE, {
    name: {
      type: Sequelize.STRING,
      allowNull: false,
      primaryKey: true,
    },
  });
}

async function getAppliedMigrations() {
  const [rows] = await sequelize.query(`SELECT name FROM "${META_TABLE}"`);
  return new Set(rows.map((row) => row.name));
}

async function markApplied(name) {
  await sequelize.query(`INSERT INTO "${META_TABLE}" (name) VALUES (:name)`, {
    replacements: { name },
  });
}

async function runMigrations() {
  const queryInterface = sequelize.getQueryInterface();
  const Sequelize = sequelize.Sequelize;

  await ensureMetaTable(queryInterface, Sequelize);
  const applied = await getAppliedMigrations();

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return;
  }

  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort();

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }

    // eslint-disable-next-line global-require, import/no-dynamic-require
    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (!migration || typeof migration.up !== 'function') {
      throw new Error(`Invalid migration file: ${file}`);
    }

    await migration.up(queryInterface, Sequelize);
    await markApplied(file);
    console.log(`Applied migration: ${file}`);
  }
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      console.log('Migrations complete.');
      await sequelize.close();
    })
    .catch(async (error) => {
      console.error('Migration failed:', error);
      await sequelize.close();
      process.exit(1);
    });
}

module.exports = {
  runMigrations,
};
