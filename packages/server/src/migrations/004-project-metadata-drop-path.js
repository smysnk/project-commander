module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    const metadataType = dialect === 'postgres'
      ? Sequelize.JSONB
      : (dialect === 'sqlite' ? Sequelize.TEXT : Sequelize.JSON);

    await queryInterface.addColumn('projects', 'metadata', {
      type: metadataType,
      allowNull: false,
      defaultValue: dialect === 'sqlite' ? '{}' : {},
    });

    const [rows] = await queryInterface.sequelize.query('SELECT id, path, metadata FROM projects');
    for (const row of rows) {
      const currentMetadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const nextMetadata = {
        ...currentMetadata,
        path: row.path,
        portBlock: currentMetadata.portBlock ?? null,
      };
      await queryInterface.bulkUpdate(
        'projects',
        { metadata: dialect === 'sqlite' ? JSON.stringify(nextMetadata) : nextMetadata },
        { id: row.id },
      );
    }

    await queryInterface.removeColumn('projects', 'path');
  },
};
