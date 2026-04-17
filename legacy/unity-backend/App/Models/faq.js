const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const faqSchema = new Schema({
    queId: {
        type: 'string'
    },
    question: {
        type: 'string',
        required: true
    },
    answer: {
        type: 'string',
        required: true
    },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },

}, { collection: 'faq' });
mongoose.model('faq', faqSchema);