const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const riskCountrySchema = new Schema({
    countryName: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
}, { versionKey: false, collection: 'riskCountry' });
mongoose.model('riskCountry', riskCountrySchema);