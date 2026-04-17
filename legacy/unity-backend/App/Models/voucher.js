const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const VoucherSchema = new Schema({
    voucherId: {
        type: 'string',
        required: true
    },
    voucherType: {
        type: 'string',
        required: true
    },
    voucherCode: {
        type: 'string',
    },
    points: {
        type: 'number',
        required: true
    },
    percentageOff: {
        type: 'number',
        required: true
    },
    status: {
        type: 'string',
        required: true
    },
    expiryDate: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'Voucher' });
mongoose.model('Voucher', VoucherSchema);