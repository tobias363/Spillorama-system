const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const agentSellPhysicalTicketSchema = new Schema({
    hallName: { type: 'string' },
    hallId: { type: Schema.Types.ObjectId, ref: 'hall' },
    hallNumber: { type: 'string', default: '' },
    gameId: { type: Schema.Types.ObjectId, ref: 'game'  },
    agentId: { type: Schema.Types.ObjectId, ref: 'agent' },
    allRange: { type: 'array', default: [] },
    isAddedInSystem: { type: "boolean", default: false },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'agentSellPhysicalTicket', versionKey: false });
mongoose.model('agentSellPhysicalTicket', agentSellPhysicalTicketSchema);