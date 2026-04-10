const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ChatsSchema = new Schema({
    playerId: {
        type: 'string',
    },
    name: {
        type: 'string',
    },
    roomId: {
        type: 'string',
    },
    emojiId: {
        type: 'string',
    },
    socketId: {
        type: 'string',
        default: ''
    },
    message: {
        type: 'string',
        default: ''
    },
    profilePic: {
        type: 'string',
        default: ''
    },
    isRead: {
        type: 'boolean',
        default: false
    },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'Chats', versionKey: false });
mongoose.model('Chats', ChatsSchema);