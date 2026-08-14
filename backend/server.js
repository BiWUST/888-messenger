const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { sequelize, User, Message } = require('./db');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*' }
});

const SECRET_KEY = 'MY_SECRET_KEY_2024';

// =============================================
// REST API
// =============================================

// РЕГИСТРАЦИЯ
app.post('/api/register', async (req, res) => {
    try {
        const { id, username, password } = req.body;

        if (!/^\d+$/.test(id)) {
            return res.status(400).json({ error: 'ID может содержать только цифры' });
        }

        if (id.length < 4) {
            return res.status(400).json({ error: 'ID должен быть минимум 4 цифры' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            id,
            username,
            password: hashedPassword
        });

        const token = jwt.sign({ id: user.id }, SECRET_KEY);
        res.json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
        res.status(400).json({ error: 'Такой ID уже существует' });
    }
});

// ВХОД
app.post('/api/login', async (req, res) => {
    try {
        const { id, password } = req.body;
        const user = await User.findByPk(id);

        if (!user) {
            return res.status(401).json({ error: 'Пользователь не найден' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: 'Неверный пароль' });
        }

        const token = jwt.sign({ id: user.id }, SECRET_KEY);
        res.json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ПОИСК ПОЛЬЗОВАТЕЛЕЙ ПО ID
app.get('/api/users/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const users = await User.findAll({
            where: {
                id: {
                    [Op.like]: `%${query}%`
                }
            },
            attributes: ['id', 'username']
        });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка поиска' });
    }
});

// ПОЛУЧИТЬ ПОЛЬЗОВАТЕЛЯ ПО ID
app.get('/api/users/:id', async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id, {
            attributes: ['id', 'username']
        });
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

// ИСТОРИЯ СООБЩЕНИЙ
app.get('/api/messages/:userId/:otherUserId', async (req, res) => {
    try {
        const { userId, otherUserId } = req.params;
        const messages = await Message.findAll({
            where: {
                [Op.or]: [
                    { fromId: userId, toId: otherUserId },
                    { fromId: otherUserId, toId: userId }
                ]
            },
            order: [['createdAt', 'ASC']]
        });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка загрузки сообщений' });
    }
});

// =============================================
// WEBSOCKET
// =============================================

io.on('connection', (socket) => {
    console.log('👤 Пользователь подключился');

    // Аутентификация и загрузка всех сообщений
    socket.on('authenticate', (token) => {
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            socket.userId = decoded.id;
            socket.join(`user_${decoded.id}`);
            console.log(`✅ Пользователь ${decoded.id} аутентифицирован`);

            // === 1. Находим ВСЕ сообщения для этого пользователя ===
            Message.findAll({
                where: {
                    toId: decoded.id
                },
                order: [['createdAt', 'ASC']]
            }).then(async (messages) => {
                if (messages.length > 0) {
                    console.log(`📦 Отправка ${messages.length} сообщений для ${decoded.id}`);
                    
                    // === 2. Отправляем все сообщения ===
                    messages.forEach(msg => {
                        socket.emit('new_message', msg);
                    });

                    // === 3. Помечаем все как прочитанные ===
                    await Message.update(
                        { read: true },
                        { where: { toId: decoded.id, read: false } }
                    );

                    // === 4. Отправляем список отправителей (чтобы создать чаты) ===
                    const senderIds = [...new Set(messages.map(m => m.fromId))];
                    for (const senderId of senderIds) {
                        const user = await User.findByPk(senderId, {
                            attributes: ['id', 'username']
                        });
                        if (user) {
                            const lastMsg = messages.filter(m => m.fromId === senderId).pop();
                            socket.emit('new_chat', {
                                userId: user.id,
                                username: user.username,
                                lastMessage: lastMsg
                            });
                        }
                    }
                }
            });

            socket.emit('authenticated', { userId: decoded.id });
        } catch (error) {
            console.log('❌ Ошибка аутентификации:', error.message);
        }
    });

    // Отправка сообщения
    socket.on('send_message', async (data) => {
        try {
            const { toId, text } = data;
            const fromId = socket.userId;

            if (!fromId) {
                console.log('❌ Пользователь не аутентифицирован');
                socket.emit('error', { message: 'Вы не аутентифицированы' });
                return;
            }

            console.log(`💬 ${fromId} -> ${toId}: ${text}`);

            const message = await Message.create({
                fromId,
                toId,
                text,
                read: false
            });

            const messageData = {
                id: message.id,
                text: message.text,
                fromId: message.fromId,
                toId: message.toId,
                read: message.read,
                createdAt: message.createdAt,
                updatedAt: message.updatedAt
            };

            // Отправляем отправителю (подтверждение)
            socket.emit('message_sent', messageData);
            console.log(`📤 Подтверждение отправлено отправителю ${fromId}`);

            // Отправляем получателю в ЕГО КОМНАТУ!
            const recipientRoom = `user_${toId}`;
            console.log(`📨 Отправка получателю ${toId} в комнату ${recipientRoom}`);
            io.to(recipientRoom).emit('new_message', messageData);
            console.log(`✅ Сообщение отправлено в комнату ${recipientRoom}`);

        } catch (error) {
            console.error('❌ Ошибка отправки:', error);
        }
    });

    // === НОВОЕ: Отметка о прочтении ВСЕХ сообщений от пользователя ===
    socket.on('mark_read', async (data) => {
        try {
            const { fromId, toId } = data;
            const updated = await Message.update(
                { read: true },
                { 
                    where: { 
                        fromId: fromId,
                        toId: toId,
                        read: false
                    } 
                }
            );
            console.log(`📖 Все сообщения от ${fromId} для ${toId} помечены как прочитанные (${updated[0]} шт.)`);
        } catch (error) {
            console.error('❌ Ошибка отметки прочтения:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log(`👋 Пользователь ${socket.userId || 'неизвестный'} отключился`);
    });
});

// =============================================
// ЗАПУСК СЕРВЕРА
// =============================================

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, async () => {
    await sequelize.sync({ force: true });
    console.log(`✅ База данных создана`);
    console.log(`🚀 Сервер запущен на http://${HOST}:${PORT}`);
    console.log(`🌐 Доступен: https://eight88-messenger.onrender.com`);
});
