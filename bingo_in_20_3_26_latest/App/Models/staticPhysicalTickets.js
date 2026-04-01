const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const staticPhysicalTicketSchema = new Schema({
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
    supplier:{
        type: 'string',
        default: ''
    },
    contractor: {
        type: 'string',
        default: ''
    },
    hallNumber: {
        type: 'string'
    },
    uniqueHallName: {
        type: 'string'
    },
    uniqueIdentifier:{
        type: 'string',
        default: ''
    },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'staticPhysicalTicket', versionKey: false });
mongoose.model('staticPhysicalTicket', staticPhysicalTicketSchema);