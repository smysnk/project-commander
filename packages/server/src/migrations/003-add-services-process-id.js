module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('services', 'process_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },
};
