'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Recording extends Model {
    static associate(models) {
      Recording.belongsTo(models.Room, { foreignKey: 'room_id', as: 'room' });
    }
  }

  Recording.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      roomId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'room_id',
      },
      filePath: {
        type: DataTypes.STRING(1024),
        allowNull: false,
        field: 'file_path',
      },
      fileSize: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
        field: 'file_size',
      },
      duration: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      storageUrl: {
        type: DataTypes.STRING(2048),
        allowNull: true,
        field: 'storage_url',
      },
    },
    {
      sequelize,
      modelName: 'Recording',
      tableName: 'recordings',
      underscored: true,
      timestamps: true,
    }
  );

  return Recording;
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR RECORDING MODEL:
1. Add a `status` enum (processing/ready/failed) so uploads can be tracked asynchronously instead of assuming the row is only created once the file is fully available.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
