const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const WithdrawEmailSchema = new Schema({
    email: {
        type: 'string',
        required: true
    },
    createrId: { type: 'string' },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'withdrawEmail',  versionKey: false });
mongoose.model('withdrawEmail', WithdrawEmailSchema);