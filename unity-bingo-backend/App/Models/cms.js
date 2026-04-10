const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const CmsSchema = new Schema({
    terms: {
        type: 'object',
    },
    support: {
        type: 'object',
    },
    aboutus: {
        type: 'object',
    },
    responsible_gameing: {
        type: 'object',
    },
    links: {
        type: 'object',
    },
    createdAt: { type: Date, default: Date.now() },
    updatedAt: { type: Date, default: Date.now() },
}, { collection: 'cms' });
mongoose.model('cms', CmsSchema);