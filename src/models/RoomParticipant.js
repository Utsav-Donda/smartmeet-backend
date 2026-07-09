'use strict';

const { DataTypes, Model } = require('sequelize');
const { ROOM_ROLES, CONNECTION_QUALITY } = require('../config/constants');

module.exports = (sequelize) => {
  class RoomParticipant extends Model {
    static associate(models) {
      RoomParticipant.belongsTo(models.Room, { foreignKey: 'room_id', as: 'room' });
      RoomParticipant.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  RoomParticipant.init(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
      },
      role: {
        type: DataTypes.ENUM(...Object.values(ROOM_ROLES)),
        allowNull: false,
        defaultValue: ROOM_ROLES.PARTICIPANT,
      },
      joinedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'joined_at',
      },
      leftAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'left_at',
      },
      isMuted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_muted',
      },
      isCameraOn: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_camera_on',
      },
      connectionQuality: {
        type: DataTypes.ENUM(...Object.values(CONNECTION_QUALITY)),
        allowNull: false,
        defaultValue: CONNECTION_QUALITY.GOOD,
        field: 'connection_quality',
      },
    },
    {
      sequelize,
      modelName: 'RoomParticipant',
      tableName: 'room_participants',
      underscored: true,
      timestamps: true,
    }
  );

  return RoomParticipant;
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR ROOM_PARTICIPANT MODEL:
1. Enforce the "one active participant row per (room_id, user_id)" invariant already present as a partial unique index in SQL via a Sequelize-level uniqueness check before insert, giving a cleaner app-level error instead of a raw DB constraint violation.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
