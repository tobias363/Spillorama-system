const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ThemeSchema = new Schema({
    
    android: {
        type: 'string'
    },
    versionAndroid: {
        type: 'number',
        default: 0
    },
    
    ios: {
        type: 'string'
    },
    versionIOS: {
        type: 'number',
        default: 0
    },

    webgl: {
        type: 'string'
    },
    versionWebGL: {
        type: 'number',
        default: 0
    },

    updatedAt: { type: Date, default: Date.now() },
    createdAt: { type: Date, default: Date.now() }
}, { collection: 'theme', versionKey: false });

mongoose.model('theme', ThemeSchema);