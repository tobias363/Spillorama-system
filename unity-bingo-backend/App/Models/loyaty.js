const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const loyalty = new Schema({
    name: {
        type: 'string',
        default: ''
    },
    points: { // Game Type Slug  Like game_1 , game_2
        type: 'number',
        default: 0
    },
    ltime: { type: Date, default: Date.now() },
    slug: {
        type: 'string',
        default: ''
    },
    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'loyalty' });
mongoose.model('loyalty', loyalty);