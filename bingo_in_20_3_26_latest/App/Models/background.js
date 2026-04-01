const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const BackgroundSchema = new Schema({
    name: {
        type: 'string',
        required: true
    },
    photo: {
        type: 'string',
        required: true,
    },
    isDefault: {
        type: 'boolean',
        default: false
    },
    price: {
        type: 'number',
        default: 0
    }
}, { collection: 'background' });
mongoose.model('background', BackgroundSchema);