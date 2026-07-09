'use strict';

const { DataTypes, Model } = require('sequelize');
const { ROOM_ACCESS_TYPES } = require('../config/constants');

module.exports = (sequelize) => {
  class Room extends Model {
    static associate(models) {
      Room.belongsTo(models.User, { foreignKey: 'host_id', as: 'host' });
      Room.hasMany(models.RoomParticipant, { foreignKey: 'room_id', as: 'participants' });
      Room.hasMany(models.Recording, { foreignKey: 'room_id', as: 'recordings' });
      Room.hasMany(models.ConnectionMetric, { foreignKey: 'room_id', as: 'connectionMetrics' });
    }

    toPublicJSON() {
      const { id, name, hostId, isActive, accessType, maxParticipants, createdAt, endedAt } = this.get();
      return { id, name, hostId, isActive, accessType, maxParticipants, createdAt, endedAt };
    }
  }

  Room.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      hostId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'host_id',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active',
      },
      accessType: {
        type: DataTypes.ENUM(...Object.values(ROOM_ACCESS_TYPES)),
        allowNull: false,
        defaultValue: ROOM_ACCESS_TYPES.PUBLIC,
        field: 'access_type',
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'password_hash',
      },
      maxParticipants: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 50,
        field: 'max_participants',
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'ended_at',
      },
    },
    {
      sequelize,
      modelName: 'Room',
      tableName: 'rooms',
      underscored: true,
      timestamps: true,
    }
  );

  return Room;
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR ROOM MODEL:
1. Add a scheduledAt/expiresAt pair to support pre-scheduled meetings and auto-expiry cleanup jobs.
PRIORITY: Low
IMPLEMENTATION_EFFORT: Medium
IMPACT: Medium
*/
