const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const GroupHallSchema = new Schema({
    name: {
        type: 'string',
        required: true
    },
    groupHallId: {
        type: 'string',
        default:''
    },
    halls: {
        type: 'array',
        default: []
    },
    agents: {
        type: 'array',
        default: []
    },
    products: {
        type: 'array',
        default:[]
    },
    status: {
        type: 'string',
        default: 'active'
    },
    tvId: {
        type: 'number',
    }
}, { collection: 'groupHall' });
mongoose.model('groupHall', GroupHallSchema);