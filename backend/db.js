const { Sequelize, DataTypes } = require('sequelize');

// Подключение к базе данных SQLite
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './database.sqlite'
});

// Модель пользователя
const User = sequelize.define('User', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        unique: true
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    }
});

// Модель сообщения
const Message = sequelize.define('Message', {
    text: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    fromId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    toId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

module.exports = { sequelize, User, Message };