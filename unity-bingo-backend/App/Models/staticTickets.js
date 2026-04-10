const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const staticTicketSchema = new Schema({
    ticketId: {
        type: 'string',
        unique: true
    },
    tickets: {
        type: 'array',
        default: []
    },
    isPurchased: {
        type: "boolean",
        default: false
    },
    playerIdOfPurchaser: {
      type: 'string'
    },
    ticketType: {
        type: 'string'
    },
    ticketColor: {
        type: 'string'
    },
    hallName: {
        type: 'string'
    },
    gameId:{
        type: 'string',
        default: ''
    },
    uniqueIdentifier:{
        type: 'string',
        default: ''
    },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'staticTicket', versionKey: false });
mongoose.model('staticTicket', staticTicketSchema);