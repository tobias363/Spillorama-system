const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const RoleSchema = new Schema({
    permission: { type: Object },
    agentId: { type: 'string' },
    agentName: { type: 'string' },
    isAssginRole: { type: Boolean, default: false },
    parentId: { type: 'string' },
    agnetIdNormal: { type: 'string' },
    isDeleted: { type: Boolean, default: false }, //1 means deleted and 0 means not deleted
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'role' });
mongoose.model('role', RoleSchema);