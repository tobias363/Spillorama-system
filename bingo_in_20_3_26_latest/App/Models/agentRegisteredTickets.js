const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const agentRegisteredTicketSchema = new Schema({
    hallName: { type: 'string' },
    hallId: { type: Schema.Types.ObjectId, ref: 'hall' },
    hallNumber: { type: 'string', default: '' },
    agentId: { type: Schema.Types.ObjectId, ref: 'agent' },
    allRange: { type: 'array', default: [] },
    // ticketColor: { type: 'string' },
    // initialId: { type: 'number' },
    // finalId: { type: 'number' },
    // ticketsAvailableFrom: { type: 'number' },
    // ticketIds: { type: 'array', default: [] },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'agentRegisteredTicket', versionKey: false });
mongoose.model('agentRegisteredTicket', agentRegisteredTicketSchema);