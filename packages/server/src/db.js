const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

require('./env');

const databaseUrl = process.env.DATABASE_URL;
const dialect = process.env.DB_DIALECT || 'sqlite';
const shouldUseDatabaseUrl = process.env.DB_USE_DATABASE_URL
  ? process.env.DB_USE_DATABASE_URL === 'true'
  : Boolean(databaseUrl);
const storagePath = process.env.DB_STORAGE
  ? (path.isAbsolute(process.env.DB_STORAGE)
      ? process.env.DB_STORAGE
      : path.resolve(process.cwd(), process.env.DB_STORAGE))
  : path.resolve(__dirname, '../data/project-commander.sqlite');

if (!databaseUrl && dialect === 'sqlite') {
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
}

const hasModule = (moduleName) => {
  try {
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
};

const getProtocol = (urlValue) => {
  try {
    return new URL(urlValue).protocol.replace(':', '');
  } catch {
    return null;
  }
};

const createSqliteClient = () =>
  new Sequelize({
    dialect: 'sqlite',
    storage: storagePath,
    logging: false,
  });

let sequelize;

if (shouldUseDatabaseUrl && databaseUrl) {
  const protocol = getProtocol(databaseUrl);
  const isPostgres = protocol === 'postgres' || protocol === 'postgresql';

  if (isPostgres && !hasModule('pg')) {
    // Keep local dev working even when DATABASE_URL is exported globally.
    console.warn('DATABASE_URL points to Postgres but `pg` is not installed; falling back to sqlite.');
    sequelize = createSqliteClient();
  } else {
    sequelize = new Sequelize(databaseUrl, { logging: false });
  }
} else if (dialect === 'sqlite') {
  sequelize = createSqliteClient();
} else {
  sequelize = new Sequelize({
    dialect,
    storage: storagePath,
    logging: false,
  });
}

module.exports = {
  sequelize,
};
