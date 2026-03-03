module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'sqlite') {
      return;
    }

    await queryInterface.sequelize.query(
      "UPDATE projects SET metadata='{}' WHERE metadata IS NULL OR metadata='' OR metadata='[object Object]'",
    );

    await queryInterface.changeColumn('projects', 'metadata', {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: '{}',
    });
  },
};
