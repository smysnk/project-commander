module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('hosts', 'source', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'runtime',
    });

    await queryInterface.addIndex('hosts', ['source']);
  },
};
