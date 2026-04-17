const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const UserSchema = new Schema({
    smsUsername: {
        type: 'string',
        required: false
    },
    smsPassword: {
        type: 'string',
        required: false
    },
    name: {
        type: 'string',
        required: true
    },
    username: {
        type: 'string',
        required: false //true
    },
    nickname: {
        type: 'string',
        required: false
    },
    email: {
        type: 'string',
        required: true
    },
    phone: {
        type: 'string',
        required: false //true
    },
    bankId: {
        type: 'string',
        required: false //true
    },
    point: {
        type: 'number',
        required: false //true
    },
    walletAmount: {
        type: 'number',
        required: false //true
    },
    soundOn: {
        type: 'boolean',
        required: false //true
    },
    role: {
        type: 'string',
        required: true
    },
    password: {
        type: 'string',
        required: true
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
    temp_chips: {
        type: 'number'
    },
    rake_chips: {
        type: 'number',
        default: 0
    },
    isTransferAllow: {
        type: 'boolean',
        default: true
    },
    isSuperAdmin: {
        type: 'boolean',
        default: false
    },
    extraRakeChips: {
        type: 'number',
        default: 0
    },
    language: {
        type: 'string',
        default: 'english'
    },
    permission: {
        type: Object,
        default: ''
    },
}, { collection: 'user' });
mongoose.model('user', UserSchema);