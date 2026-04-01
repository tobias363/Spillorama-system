const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const AgentSchema = new Schema({
    name: {
        type: 'string',
        required: true
    },
    agentId: {
        type: 'string',
    },
    roleId: {
        type: Schema.Types.ObjectId,
    },
    parentId: {
        type: Schema.Types.ObjectId,
        require: true
    },
    password: {
        type: 'string',
    },
    copassword: {
        type: 'string'
    },
    email: {
        type: 'string',
        required: true
    },
    phone: {
        type: 'string',
        required: true
    },
    bankId: {
        type: 'string',
        required: false
    },
    point: {
        type: 'number',
        required: false
    },
    hall: {
        type: 'array',
        default: []
    },
    groupHall: {
        type: 'object', default: {}
    },
    uniqId: {
        type: 'string',
        required: false
    },
    walletAmount: {
        type: 'number',
        default: 0
    },
    soundOn: {
        type: 'boolean',
        required: false
    },
    avatar: {
        type: 'string'
    },
    status: {
        type: 'string',
        defaultsTo: 'active'
    },
    resetPasswordToken: {
        type: 'string',
    },
    resetPasswordExpires: {
        type: 'string',
    },
    chips: {
        type: 'number',
        default: 10000000
    },
    language: {
        type: 'string',
        default: 'english'
    },
    lastParentId: {
        type: Schema.Types.ObjectId,
        require: true
    },
    // registeredTickets: {
    //     type: 'array',
    //     default: []
    // },
}, { collection: 'agent',minimize: false });
mongoose.model('agent', AgentSchema);