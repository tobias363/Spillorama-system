const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const PatternSchema = new Schema({
    gameName: {
        type: 'string'
    },
    gameType: {
        type: 'string'
    },
    patternNumber: {
        type: 'string'
    },
    patternName: {
        type: 'string'
    },
    patternType: {
        type: 'string'
    },
    fixedPatternType: {
        type: "array"
    },
    creationDateTime: {
        type: Date,
        default: Date.now()
    },
    count: {
        type: 'number'
    },
    patternPlace: {
        type: 'string'
    },
    status: {
        type: 'string'
    },
    isWoF: {
        type: 'boolean',
        default: false
    },
    isFixedPtrn: {
        type: 'boolean',
        default: false,
        required:true
    },
    isMys: {
        type: 'boolean',
        default: false
    },
    isRowPr: {
        type: 'boolean',
        default: false
    },
    isJackpot: {
        type: 'boolean',
        default: false
    },
    isGameTypeExtra: {
        type: 'boolean',
        default: false
    },
    rowPercentage: {
        type: 'number'
    },
    gameOnePatternType: {
        type: 'array'
    },
    patType: {
        type: 'string'
    },
    isLuckyBonus: {
        type: 'boolean',
        default: false
    },
    // patternPrice: {
    //     type: 'number'
    // },
    createrId: { type: 'string' },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'pattern', versionKey: false });
mongoose.model('pattern', PatternSchema);