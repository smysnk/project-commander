module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    const metadataType = dialect === 'postgres'
      ? Sequelize.JSONB
      : (dialect === 'sqlite' ? Sequelize.TEXT : Sequelize.JSON);

    await queryInterface.addColumn('hosts', 'metadata', {
      type: metadataType,
      allowNull: false,
      defaultValue: dialect === 'sqlite' ? '{}' : {},
    });
  },
};
